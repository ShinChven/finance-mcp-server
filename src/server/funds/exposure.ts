/**
 * Exposure math — pure functions, no database.
 *
 * The relationship tools are only as trustworthy as these numbers, so every
 * computation carries a `coverage` figure alongside the weight: a fund showing
 * 5% semiconductors at 30% coverage is a very different claim from 5% at 95%,
 * and collapsing the two is how holdings-derived analysis quietly lies.
 */

export interface HoldingInput {
  symbol: string;
  weight: number;
  reportDate?: string;
}

export interface SectorTag {
  taxonomy: string;
  sectorCode: string;
  sectorName?: string | null;
}

export interface ExposureCell {
  dimension: "sector" | "market";
  taxonomy: string;
  key: string;
  label: string | null;
  weight: number;
  coverage: number;
}

export interface ComputeExposureInput {
  holdings: HoldingInput[];
  /** symbol → sector tags (a symbol may be classified in several taxonomies) */
  sectors: Map<string, SectorTag[]>;
  /** symbol → market code */
  markets: Map<string, string>;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Aggregates holding weights into sector and market exposure.
 *
 * Weights are percent-of-NAV as disclosed; they are not renormalized, because
 * a fund holding 60% equities genuinely has 60% equity exposure and scaling it
 * to 100% would overstate every sector.
 */
export function computeExposure(input: ComputeExposureInput): ExposureCell[] {
  const { holdings, sectors, markets } = input;
  const totalWeight = holdings.reduce((sum, holding) => sum + holding.weight, 0);
  if (totalWeight <= 0) return [];

  const sectorWeights = new Map<string, Map<string, { label: string | null; weight: number }>>();
  const classifiedByTaxonomy = new Map<string, number>();
  const marketWeights = new Map<string, number>();
  let marketClassified = 0;

  for (const holding of holdings) {
    const tags = sectors.get(holding.symbol) ?? [];
    const seenTaxonomies = new Set<string>();
    for (const tag of tags) {
      let byCode = sectorWeights.get(tag.taxonomy);
      if (byCode === undefined) {
        byCode = new Map();
        sectorWeights.set(tag.taxonomy, byCode);
      }
      const current = byCode.get(tag.sectorCode);
      const label = tag.sectorName ?? null;
      if (current) {
        current.weight += holding.weight;
        current.label ??= label;
      } else {
        byCode.set(tag.sectorCode, { label, weight: holding.weight });
      }
      // A symbol counts once per taxonomy toward coverage even if it carries
      // several tags within that taxonomy.
      if (!seenTaxonomies.has(tag.taxonomy)) {
        seenTaxonomies.add(tag.taxonomy);
        classifiedByTaxonomy.set(
          tag.taxonomy,
          (classifiedByTaxonomy.get(tag.taxonomy) ?? 0) + holding.weight,
        );
      }
    }

    const market = markets.get(holding.symbol);
    if (market !== undefined) {
      marketWeights.set(market, (marketWeights.get(market) ?? 0) + holding.weight);
      marketClassified += holding.weight;
    }
  }

  const cells: ExposureCell[] = [];

  for (const [taxonomy, byCode] of sectorWeights) {
    const coverage = round((classifiedByTaxonomy.get(taxonomy) ?? 0) / totalWeight);
    for (const [sectorCode, value] of byCode) {
      cells.push({
        dimension: "sector",
        taxonomy,
        key: sectorCode,
        label: value.label,
        weight: round(value.weight),
        coverage,
      });
    }
  }

  const marketCoverage = round(marketClassified / totalWeight);
  for (const [market, weight] of marketWeights) {
    cells.push({
      dimension: "market",
      taxonomy: "",
      key: market,
      label: market,
      weight: round(weight),
      coverage: marketCoverage,
    });
  }

  return cells.sort((a, b) => b.weight - a.weight);
}

/** Cosine similarity over a shared key space; returns 0 when either side is empty. */
export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const [key, value] of a) {
    normA += value * value;
    const other = b.get(key);
    if (other !== undefined) dot += value * other;
  }
  for (const value of b.values()) normB += value * value;

  if (normA === 0 || normB === 0) return 0;
  return round(dot / (Math.sqrt(normA) * Math.sqrt(normB)));
}

/**
 * Portfolio overlap: the weight two funds hold in common, as the sum of
 * min(weight) over shared positions. Reads directly as "x% of NAV is the same
 * bet", which is the number that matters when deciding whether a second fund
 * adds anything.
 */
export function holdingsOverlap(a: HoldingInput[], b: HoldingInput[]): number {
  const byCode = new Map<string, number>();
  for (const holding of a) {
    byCode.set(holding.symbol, (byCode.get(holding.symbol) ?? 0) + holding.weight);
  }

  let overlap = 0;
  const counted = new Map<string, number>();
  for (const holding of b) {
    counted.set(holding.symbol, (counted.get(holding.symbol) ?? 0) + holding.weight);
  }
  for (const [symbol, weight] of counted) {
    const mine = byCode.get(symbol);
    if (mine !== undefined) overlap += Math.min(mine, weight);
  }
  return round(overlap);
}

export interface StabilityResult {
  /** Share of the earlier period's weight still held in the later period. */
  stability: number;
  retained: string[];
  dropped: string[];
  added: string[];
}

/**
 * Holdings stability between two consecutive reports.
 *
 * Index funds sit near 1.0; a low value means last quarter's portfolio no longer
 * describes the fund, so any exposure derived from it should be discounted.
 */
export function holdingStability(
  previous: HoldingInput[],
  current: HoldingInput[],
): StabilityResult {
  const previousSymbols = new Set(previous.map((holding) => holding.symbol));
  const currentSymbols = new Set(current.map((holding) => holding.symbol));

  const previousWeight = previous.reduce((sum, holding) => sum + holding.weight, 0);
  const retainedWeight = previous
    .filter((holding) => currentSymbols.has(holding.symbol))
    .reduce((sum, holding) => sum + holding.weight, 0);

  return {
    stability: previousWeight > 0 ? round(retainedWeight / previousWeight) : 0,
    retained: [...previousSymbols].filter((symbol) => currentSymbols.has(symbol)),
    dropped: [...previousSymbols].filter((symbol) => !currentSymbols.has(symbol)),
    added: [...currentSymbols].filter((symbol) => !previousSymbols.has(symbol)),
  };
}

/** Builds the vector `find_similar_funds` compares — sector cells only. */
export function toExposureVector(cells: ExposureCell[]): Map<string, number> {
  const vector = new Map<string, number>();
  for (const cell of cells) {
    if (cell.dimension !== "sector") continue;
    vector.set(`${cell.taxonomy}:${cell.key}`, cell.weight);
  }
  return vector;
}
