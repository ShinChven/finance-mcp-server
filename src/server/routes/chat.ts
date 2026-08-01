import { Hono } from "hono";
import { stream } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { and, asc, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { chatConversations, chatMessages, type User } from "../db/schema.js";
import { audit } from "../lib/audit.js";
import { clientIp, type AppEnv } from "../lib/http.js";
import { escapeLike, listQuerySchema, listResponse } from "../lib/listing.js";
import { rateLimit } from "../middleware/ratelimit.js";
import { requireAuth } from "../middleware/session.js";
import { configuredProviders, isChatEnabled, resolveProviderModel } from "../chat/models.js";
import { streamChat, type ChatTurn } from "../chat/providers.js";

const HISTORY_LIMIT = 40;
const MAX_MESSAGE_LENGTH = 32_000;

function systemPrompt(user: User): string {
  return [
    "You are the built-in assistant of an MCP server dashboard — a web app where users manage",
    "personal access tokens and OAuth clients for connecting MCP (Model Context Protocol) clients.",
    `You are chatting with ${user.displayName || user.name || user.email}.`,
    "Be helpful, accurate, and concise. Use Markdown formatting when it improves readability.",
  ].join(" ");
}

const createSchema = z.object({
  provider: z.string().max(30).optional(),
  model: z.string().max(80).optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  provider: z.string().max(30).optional(),
  model: z.string().max(80).optional(),
});

const sendSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});

async function ownedConversation(userId: string, id: string) {
  const rows = await db
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.id, id), eq(chatConversations.userId, userId)))
    .limit(1);
  return rows[0];
}

export const chatRoutes = new Hono<AppEnv>()
  .use(requireAuth)

  .get("/providers", (c) => {
    const providers = configuredProviders();
    return c.json({
      enabled: providers.length > 0,
      providers,
      default: resolveProviderModel(undefined, undefined),
    });
  })

  .get("/conversations", zValidator("query", listQuerySchema), async (c) => {
    const query = c.req.valid("query");
    const user = c.get("user");
    const filters: SQL[] = [eq(chatConversations.userId, user.id)];
    if (query.q) filters.push(ilike(chatConversations.title, `%${escapeLike(query.q)}%`));
    const where = and(...filters);
    const [totalRow] = await db.select({ n: count() }).from(chatConversations).where(where);
    const rows = await db
      .select()
      .from(chatConversations)
      .where(where)
      .orderBy(desc(chatConversations.updatedAt))
      .limit(query.per_page)
      .offset((query.page - 1) * query.per_page);
    return c.json(listResponse(rows, totalRow?.n ?? 0, query));
  })

  .post("/conversations", zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    if (!isChatEnabled()) return c.json({ error: "no chat provider is configured" }, 503);
    const resolved = resolveProviderModel(body.provider, body.model)!;
    const [conversation] = await db
      .insert(chatConversations)
      .values({ userId: user.id, provider: resolved.provider, model: resolved.model })
      .returning();
    return c.json({ conversation }, 201);
  })

  .get("/conversations/:id", async (c) => {
    const user = c.get("user");
    const conversation = await ownedConversation(user.id, c.req.param("id"));
    if (!conversation) return c.json({ error: "not found" }, 404);
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.conversationId, conversation.id))
      .orderBy(asc(chatMessages.createdAt));
    return c.json({ conversation, messages });
  })

  .patch("/conversations/:id", zValidator("json", updateSchema), async (c) => {
    const body = c.req.valid("json");
    const user = c.get("user");
    const conversation = await ownedConversation(user.id, c.req.param("id"));
    if (!conversation) return c.json({ error: "not found" }, 404);
    const updates: Partial<typeof chatConversations.$inferInsert> = {};
    if (body.title) updates.title = body.title;
    if (body.provider || body.model) {
      const resolved = resolveProviderModel(
        body.provider ?? conversation.provider,
        body.model ?? conversation.model,
      );
      if (!resolved) return c.json({ error: "no chat provider is configured" }, 503);
      updates.provider = resolved.provider;
      updates.model = resolved.model;
    }
    const [updated] = await db
      .update(chatConversations)
      .set(updates)
      .where(eq(chatConversations.id, conversation.id))
      .returning();
    return c.json({ conversation: updated });
  })

  .delete("/conversations/:id", async (c) => {
    const user = c.get("user");
    const conversation = await ownedConversation(user.id, c.req.param("id"));
    if (!conversation) return c.json({ error: "not found" }, 404);
    // FK cascade removes the conversation's messages.
    await db.delete(chatConversations).where(eq(chatConversations.id, conversation.id));
    return c.json({ ok: true });
  })

  // Send a message; responds with an ndjson stream of
  // {type:"delta",text} → {type:"done",message,usage} (or {type:"error",error}).
  .post(
    "/conversations/:id/messages",
    rateLimit({ windowMs: 60_000, max: 20 }),
    zValidator("json", sendSchema),
    async (c) => {
      const { content } = c.req.valid("json");
      const user = c.get("user");
      const conversation = await ownedConversation(user.id, c.req.param("id"));
      if (!conversation) return c.json({ error: "not found" }, 404);
      const resolved = resolveProviderModel(conversation.provider, conversation.model);
      if (!resolved) return c.json({ error: "no chat provider is configured" }, 503);

      await db.insert(chatMessages).values({
        conversationId: conversation.id,
        role: "user",
        content,
      });

      const history = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.conversationId, conversation.id))
        .orderBy(desc(chatMessages.createdAt))
        .limit(HISTORY_LIMIT);
      const turns: ChatTurn[] = history
        .reverse()
        .map((m) => ({ role: m.role, content: m.content }));

      c.header("Content-Type", "application/x-ndjson");

      return stream(c, async (body) => {
        const write = (payload: unknown) => body.write(JSON.stringify(payload) + "\n");
        try {
          const result = await streamChat({
            provider: resolved.provider,
            model: resolved.model,
            system: systemPrompt(user),
            messages: turns,
            onDelta: (text) => void write({ type: "delta", text }),
            signal: c.req.raw.signal,
          });

          const [saved] = await db
            .insert(chatMessages)
            .values({
              conversationId: conversation.id,
              role: "assistant",
              content: result.text,
              model: resolved.model,
            })
            .returning();
          const updates: Partial<typeof chatConversations.$inferInsert> = { updatedAt: new Date() };
          if (conversation.title === "New chat") {
            updates.title = content.length > 60 ? `${content.slice(0, 57)}…` : content;
          }
          await db
            .update(chatConversations)
            .set(updates)
            .where(eq(chatConversations.id, conversation.id));
          await audit({
            actorUserId: user.id,
            action: "chat.message",
            targetType: "chat_conversation",
            targetId: conversation.id,
            meta: { provider: resolved.provider, model: resolved.model, ...result.usage },
            ip: clientIp(c),
          });
          await write({ type: "done", message: saved, usage: result.usage ?? null });
        } catch (err) {
          console.error("chat stream failed:", err);
          const message = err instanceof Error ? err.message : "chat request failed";
          await write({ type: "error", error: message });
        }
      });
    },
  );
