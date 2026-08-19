/**
 * Classifying a China fund from the two strings the universe index gives us.
 *
 * Pure and separate from `parse.ts` because these are judgements, not shape
 * knowledge: a format drift breaks a parser, whereas a new naming fashion in
 * fund marketing quietly degrades these. Keeping them apart means the fixtures
 * that guard each stay honest about what they are guarding.
 */

/**
 * Whether the fund's mandate points outside China.
 *
 * The 基金类型 string is the reliable signal; the name is a fallback for share
 * classes that omit it. This is the CN-specific half of the cross-market
 * `funds.invests_offshore` flag — QDII is the regulatory wrapper China requires
 * for it, so on this provider the two coincide.
 */
export function looksLikeOffshoreMandate(fundType: string | null, name: string): boolean {
  const haystack = `${fundType ?? ""} ${name}`.toUpperCase();
  if (haystack.includes("QDII")) return true;
  return /(纳斯达克|标普|美国|海外|全球|日经|德国|越南|印度|恒生|香港|亚太)/.test(haystack);
}

/** Index mandate, before the profile page confirms it with a 跟踪标的. */
export function looksLikeIndexFund(fundType: string | null, name: string): boolean {
  return /指数|ETF|LOF/.test(`${fundType ?? ""} ${name}`);
}

/**
 * 亿元 (100M CNY) as disclosed, converted to the millions the `funds.fund_size`
 * column is denominated in.
 *
 * Without this the column mixes units across providers and any sort or
 * comparison over it is meaningless — a 50亿 China fund would outrank a
 * $400bn US ETF.
 */
export function fundSizeToMillions(sizeInYi: number | null): number | null {
  return sizeInYi === null ? null : sizeInYi * 100;
}
