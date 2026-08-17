/**
 * Theme crosswalk — the hand-maintained bridge between the CN and US/global
 * classification systems.
 *
 * Nothing here can be scraped: Eastmoney/Shenwan board names and Yahoo's GICS
 * sector names describe the same economic exposure with different vocabularies,
 * and only an explicit mapping lets "semiconductors" return both a CN
 * semiconductor ETF and a QDII tracking SOX.
 *
 * `cnBoards` holds Eastmoney BK codes where they are known; matching falls back
 * to `cnSectorNames`, which is what the ingest actually stores as
 * `instrument_sectors.sector_name`. Leave a BK code out rather than guess it —
 * an empty list degrades to name matching, a wrong code silently returns
 * nothing.
 */

export interface ThemeDefinition {
  id: string;
  /** Aliases used for lookup — Chinese and English, matched case-insensitively. */
  labels: string[];
  /** Eastmoney board names on the CN side (`instrument_sectors.sector_name`). */
  cnSectorNames: string[];
  /** Eastmoney BK codes, when known. Optional by design — see file header. */
  cnBoards?: string[];
  /** Yahoo `assetProfile.sector` values on the US/global side. */
  gicsSectors: string[];
  /** Yahoo `assetProfile.industry` values, for themes narrower than a sector. */
  gicsIndustries?: string[];
  /** Index codes that funds may track (matched against `funds.tracking_index`). */
  indices: string[];
  /** Restricts the theme to given markets — used by country/region themes. */
  markets?: string[];
  note?: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "semiconductors",
    labels: ["半导体", "芯片", "semiconductor", "semiconductors", "chips"],
    cnSectorNames: ["半导体", "芯片概念", "半导体及元件"],
    gicsSectors: ["Technology"],
    gicsIndustries: ["Semiconductors", "Semiconductor Equipment & Materials"],
    indices: ["中证半导体", "国证半导体芯片", "SOX", "费城半导体", "中华半导体芯片"],
  },
  {
    id: "software_internet",
    labels: ["软件", "互联网", "software", "internet"],
    cnSectorNames: ["软件开发", "互联网服务", "计算机应用"],
    gicsSectors: ["Technology", "Communication Services"],
    gicsIndustries: ["Software—Application", "Software—Infrastructure", "Internet Content & Information"],
    indices: ["中证软件服务", "中证海外中国互联网", "恒生科技"],
  },
  {
    id: "artificial_intelligence",
    labels: ["人工智能", "ai", "artificial intelligence"],
    cnSectorNames: ["人工智能", "算力概念", "云计算"],
    gicsSectors: ["Technology"],
    gicsIndustries: ["Software—Infrastructure", "Semiconductors", "Information Technology Services"],
    indices: ["中证人工智能产业", "中证人工智能主题"],
  },
  {
    id: "new_energy",
    labels: ["新能源", "光伏", "锂电", "new energy", "solar", "battery"],
    cnSectorNames: ["光伏设备", "电池", "新能源", "电源设备"],
    gicsSectors: ["Technology", "Industrials", "Consumer Cyclical"],
    gicsIndustries: ["Solar", "Electrical Equipment & Parts"],
    indices: ["中证新能源", "中证光伏产业", "国证新能源车电池"],
  },
  {
    id: "electric_vehicles",
    labels: ["新能源车", "电动车", "汽车", "ev", "electric vehicle", "auto"],
    cnSectorNames: ["汽车整车", "汽车零部件", "新能源车"],
    gicsSectors: ["Consumer Cyclical"],
    gicsIndustries: ["Auto Manufacturers", "Auto Parts"],
    indices: ["中证新能源汽车", "国证新能源车电池"],
  },
  {
    id: "healthcare",
    labels: ["医药", "医疗", "生物", "healthcare", "biotech", "pharma"],
    cnSectorNames: ["医药制造", "生物制品", "医疗器械", "医疗服务"],
    gicsSectors: ["Healthcare"],
    gicsIndustries: ["Biotechnology", "Drug Manufacturers—General", "Medical Devices"],
    indices: ["中证医药", "中证生物医药", "恒生医疗保健", "NBI"],
  },
  {
    id: "consumer",
    labels: ["消费", "白酒", "食品饮料", "consumer", "staples"],
    cnSectorNames: ["白酒", "食品饮料", "家用电器", "商业百货"],
    gicsSectors: ["Consumer Defensive", "Consumer Cyclical"],
    indices: ["中证消费", "中证白酒", "中证主要消费"],
  },
  {
    id: "financials",
    labels: ["金融", "银行", "券商", "保险", "financial", "banks"],
    cnSectorNames: ["银行", "证券", "保险", "多元金融"],
    gicsSectors: ["Financial Services"],
    indices: ["中证银行", "中证全指证券公司", "恒生金融"],
  },
  {
    id: "energy_oil",
    labels: ["石油", "原油", "能源", "oil", "energy", "crude"],
    cnSectorNames: ["石油行业", "煤炭行业", "采掘行业"],
    gicsSectors: ["Energy"],
    gicsIndustries: ["Oil & Gas E&P", "Oil & Gas Integrated"],
    indices: ["标普石油天然气上游", "中证石油天然气", "SPSIOP"],
    note: "QDII oil funds often track upstream E&P rather than spot crude — check tracking_index before assuming crude beta.",
  },
  {
    id: "real_estate",
    labels: ["房地产", "地产", "reits", "real estate"],
    cnSectorNames: ["房地产开发", "房地产服务"],
    gicsSectors: ["Real Estate"],
    indices: ["中证全指房地产", "道琼斯美国精选REIT"],
  },
  {
    id: "military",
    labels: ["军工", "国防", "defense", "aerospace"],
    cnSectorNames: ["航天航空", "国防军工"],
    gicsSectors: ["Industrials"],
    gicsIndustries: ["Aerospace & Defense"],
    indices: ["中证军工", "国证航天航空"],
  },

  /* ---- Country / region themes: the QDII side of the map ---- */
  {
    id: "us_broad",
    labels: ["美股", "标普", "美国", "us", "sp500", "s&p 500"],
    cnSectorNames: [],
    gicsSectors: [],
    indices: ["标普500", "S&P 500", "^GSPC", "道琼斯工业平均", "MSCI美国"],
    markets: ["US"],
  },
  {
    id: "us_nasdaq",
    labels: ["纳斯达克", "纳指", "nasdaq", "ndx"],
    cnSectorNames: [],
    gicsSectors: [],
    indices: ["纳斯达克100", "NASDAQ 100", "^NDX"],
    markets: ["US"],
  },
  {
    id: "hong_kong",
    labels: ["港股", "恒生", "hong kong", "hsi"],
    cnSectorNames: [],
    gicsSectors: [],
    indices: ["恒生指数", "恒生中国企业", "恒生科技", "^HSI"],
    markets: ["HK"],
  },
  {
    id: "japan",
    labels: ["日本", "日经", "japan", "nikkei"],
    cnSectorNames: [],
    gicsSectors: [],
    indices: ["日经225", "Nikkei 225", "^N225", "东证"],
    markets: ["JP"],
  },
  {
    id: "germany_europe",
    labels: ["德国", "欧洲", "germany", "europe", "dax"],
    cnSectorNames: [],
    gicsSectors: [],
    indices: ["德国DAX", "DAX", "^GDAXI", "欧洲STOXX50"],
    markets: ["DE", "FR", "NL", "EU"],
  },
  {
    id: "vietnam",
    labels: ["越南", "vietnam"],
    cnSectorNames: [],
    gicsSectors: [],
    indices: ["胡志明", "VN30", "富时越南"],
    markets: ["VN"],
  },
  {
    id: "india",
    labels: ["印度", "india", "nifty"],
    cnSectorNames: [],
    gicsSectors: [],
    indices: ["印度Nifty50", "NIFTY 50", "孟买"],
    markets: ["IN"],
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Exact alias match first, then substring — so "半导体" beats a loose hit on
 *  a theme that merely mentions chips in another alias. */
export function findTheme(query: string): ThemeDefinition | undefined {
  const needle = normalize(query);
  if (needle === "") return undefined;

  const exact = THEMES.find(
    (theme) => theme.id === needle || theme.labels.some((label) => normalize(label) === needle),
  );
  if (exact) return exact;

  return THEMES.find((theme) =>
    theme.labels.some((label) => {
      const hay = normalize(label);
      return hay.includes(needle) || needle.includes(hay);
    }),
  );
}

export function listThemeIds(): string[] {
  return THEMES.map((theme) => theme.id);
}
