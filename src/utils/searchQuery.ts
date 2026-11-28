// 日本語検索変換ユーティリティ（全角半角・半角カナ・ローマ字→かな/カナ・ニコニコ頻出語変換）

const HALF_KANA_MAP: Record<string, string> = {
  'ｶﾞ': 'ガ', 'ｷﾞ': 'ギ', 'ｸﾞ': 'グ', 'ｹﾞ': 'ゲ', 'ｺﾞ': 'ゴ',
  'ｻﾞ': 'ザ', 'ｼﾞ': 'ジ', 'ｽﾞ': 'ズ', 'ｾﾞ': 'ゼ', 'ｿﾞ': 'ゾ',
  'ﾀﾞ': 'ダ', 'ﾁﾞ': 'ヂ', 'ﾂﾞ': 'ヅ', 'ﾃﾞ': 'デ', 'ﾄﾞ': 'ド',
  'ﾊﾞ': 'バ', 'ﾋﾞ': 'ビ', 'ﾌﾞ': 'ブ', 'ﾍﾞ': 'ベ', 'ﾎﾞ': 'ボ',
  'ﾊﾟ': 'パ', 'ﾋﾟ': 'ピ', 'ﾌﾟ': 'プ', 'ﾍﾟ': 'ペ', 'ﾎﾟ': 'ポ',
  'ｳﾞ': 'ヴ', 'ﾜﾞ': 'ヷ', 'ｦﾞ': 'ヺ',
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
  'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｯ': 'ッ', 'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ',
  '｡': '。', '､': '、', 'ｰ': 'ー', '｢': '「', '｣': '」', '･': '・'
};

const ROMAJI_TABLE: Array<[string, string]> = [
  ['ltsu', 'っ'], ['xtsu', 'っ'], ['kya', 'きゃ'], ['kyu', 'きゅ'], ['kyo', 'きょ'],
  ['sha', 'しゃ'], ['shi', 'し'], ['shu', 'しゅ'], ['sho', 'しょ'],
  ['sya', 'しゃ'], ['syu', 'しゅ'], ['syo', 'しょ'],
  ['cha', 'ちゃ'], ['chi', 'ち'], ['chu', 'ちゅ'], ['cho', 'ちょ'],
  ['tya', 'ちゃ'], ['tyu', 'ちゅ'], ['tyo', 'ちょ'],
  ['tsu', 'つ'], ['nya', 'にゃ'], ['nyu', 'にゅ'], ['nyo', 'にょ'],
  ['hya', 'ひゃ'], ['hyu', 'ひゅ'], ['hyo', 'ひょ'],
  ['mya', 'みゃ'], ['myu', 'みゅ'], ['myo', 'みょ'],
  ['rya', 'りゃ'], ['ryu', 'りゅ'], ['ryo', 'りょ'],
  ['gya', 'ぎゃ'], ['gyu', 'ぎゅ'], ['gyo', 'ぎょ'],
  ['ja', 'じゃ'], ['ju', 'じゅ'], ['jo', 'じょ'],
  ['zya', 'じゃ'], ['zyu', 'じゅ'], ['zyo', 'じょ'],
  ['jya', 'じゃ'], ['jyu', 'じゅ'], ['jyo', 'じょ'],
  ['bya', 'びゃ'], ['byu', 'びゅ'], ['byo', 'びょ'],
  ['pya', 'ぴゃ'], ['pyu', 'ぴゅ'], ['pyo', 'ぴょ'],
  ['fa', 'ふぁ'], ['fi', 'ふぃ'], ['fe', 'ふぇ'], ['fo', 'ふぉ'],
  ['va', 'ゔぁ'], ['vi', 'ゔぃ'], ['vu', 'ゔ'], ['ve', 'ゔぇ'], ['vo', 'ゔぉ'],
  ['wi', 'うぃ'], ['we', 'うぇ'],
  ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
  ['sa', 'さ'], ['si', 'し'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
  ['ta', 'た'], ['ti', 'ち'], ['tu', 'つ'], ['te', 'て'], ['to', 'と'],
  ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
  ['ha', 'は'], ['hi', 'ひ'], ['hu', 'ふ'], ['fu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
  ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
  ['ya', 'や'], ['yu', 'ゆ'], ['yo', 'よ'],
  ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
  ['wa', 'わ'], ['wo', 'を'], ['nn', 'ん'], ["n'", 'ん'],
  ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
  ['za', 'ざ'], ['zi', 'じ'], ['ji', 'じ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
  ['da', 'だ'], ['di', 'ぢ'], ['du', 'づ'], ['de', 'で'], ['do', 'ど'],
  ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
  ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
  ['la', 'ぁ'], ['li', 'ぃ'], ['lu', 'ぅ'], ['le', 'ぇ'], ['lo', 'ぉ'],
  ['xa', 'ぁ'], ['xi', 'ぃ'], ['xu', 'ぅ'], ['xe', 'ぇ'], ['xo', 'ぉ'],
  ['ltu', 'っ'], ['xtu', 'っ'],
  ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],
  ['-', 'ー']
];

const POPULAR_QUERY_DICT: Record<string, string> = {
  // ボカロ・楽曲
  bokaro: 'ボカロ',
  bokaroido: 'ボカロ',
  vocaloid: 'VOCALOID',
  hatsunemiku: '初音ミク',
  hatunemiku: '初音ミク',
  miku: '初音ミク',
  miku39: '初音ミク',
  kagaminerin: '鏡音リン',
  kagaminelen: '鏡音レン',
  megurineluka: '巡音ルカ',
  kaito: 'KAITO',
  meiko: 'MEIKO',
  kasane: '重音テト',
  kasaneteto: '重音テト',
  teto: '重音テト',
  zundamon: 'ずんだもん',
  senbonzakura: '千本桜',
  badapple: 'Bad Apple!!',
  kyoufuu: '強風オールバック',
  idol: 'アイドル',
  mesmerizer: 'メズマライザー',
  monitoring: 'モニタリング',
  // アーティスト・グループ
  yorushika: 'ヨルシカ',
  yoasobi: 'YOASOBI',
  zutomayo: 'ずっと真夜中でいいのに',
  kessoku: '結束バンド',
  bocchitherock: 'ぼっち・ざ・ろっく',
  kenshiyonezu: '米津玄師',
  yonezu: '米津玄師',
  hachi: 'ハチ',
  wowaka: 'wowaka',
  deco27: 'DECO*27',
  kairiki: 'かいりきベア',
  // ニコニコ定番・アニメ・ゲーム
  touhou: '東方',
  toho: '東方',
  chirno: 'チルノ',
  chiruno: 'チルノ',
  onmyouji: '陰陽師',
  onmyoji: '陰陽師',
  kumikyoku: '組曲『ニコニコ動画』',
  ryuuseigun: 'ニコニコ動画流星群',
  reimu: '霊夢',
  marisa: '魔理沙',
  maikura: 'マイクラ',
  minecraft: 'Minecraft',
  umamusume: 'ウマ娘',
  genshin: '原神',
  puroseka: 'プロセカ',
  proseka: 'プロセカ',
  buruaaka: 'ブルアカ',
  bocchi: 'ぼっち・ざ・ろっく',
  shingeki: '進撃の巨人',
  kimetsu: '鬼滅の刃',
  jujutsu: '呪術廻戦',
  gintama: '銀魂',
  nijisanji: 'にじさんじ',
  hololive: 'ホロライブ',
  hororaibu: 'ホロライブ',
  ryouri: '料理',
  raamen: 'ラーメン',
  ramen: 'ラーメン',
  bgm: '作業用BGM',
  sagyoubgm: '作業用BGM',
  sagyobgm: '作業用BGM',
  mad: '音MAD',
  otomad: '音MAD',
  jikkyou: '実況プレイ',
  rta: 'RTA',
  voiceroid: 'VOICEROID',
  voicevox: 'VOICEVOX',
  utattemita: '歌ってみた',
  odottemita: '踊ってみた',
  ensou: '演奏してみた',
  nikoniko: 'ニコニコ',
  niconico: 'ニコニコ'
};

export function normalizeHalfWidthAndSpaces(input: string): string {
  const halfKanaReplaced = input.replace(
    /([ｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾊﾋﾌﾍﾎｳﾜｦ]ﾞ|[ﾊﾋﾌﾍﾎ]ﾟ|[ｱ-ﾝｧ-ｮｯ｡､ｰ｢｣･])/g,
    (m) => HALF_KANA_MAP[m] || m
  );
  return halfKanaReplaced
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hiraganaToKatakana(input: string): string {
  return input.replace(/[\u3041-\u3096]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

export function katakanaToHiragana(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );
}

export function romajiToHiragana(input: string): string {
  const src = input.toLowerCase();
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // 促音（連続子音 kk, tt, pp 等、n 以外）
    if (
      i + 1 < src.length &&
      ch >= 'a' &&
      ch <= 'z' &&
      ch === src[i + 1] &&
      !'aiueon'.includes(ch)
    ) {
      out += 'っ';
      i += 1;
      continue;
    }
    let matched = false;
    for (const [romaji, hira] of ROMAJI_TABLE) {
      if (src.startsWith(romaji, i)) {
        out += hira;
        i += romaji.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    // 子音のあとの n -> ん
    if (ch === 'n') {
      const next = src[i + 1];
      if (!next || (!'aiueoy'.includes(next) && next !== 'n')) {
        out += 'ん';
        i += 1;
        continue;
      }
    }
    out += src[i];
    i += 1;
  }
  return out;
}

export interface SearchConversionResult {
  raw: string;
  normalized: string;
  converted: string;
  wasConverted: boolean;
  reason?: string;
  alternatives: string[];
}

export function convertSearchQuery(rawInput: string, enabled: boolean = true): SearchConversionResult {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return { raw: '', normalized: '', converted: '', wasConverted: false, alternatives: [] };
  }
  if (!enabled) {
    return { raw, normalized: raw, converted: raw, wasConverted: false, alternatives: [] };
  }

  // URL・ID直打ち時はID抽出を優先（変換しない）
  const idMatch = raw.match(/\b((?:sm|so|nm|lv)\d+)\b/i);
  if (idMatch && (raw.includes('nicovideo') || raw.includes('nico.ms') || /^(sm|so|nm|lv)\d+$/i.test(raw))) {
    const cleanId = idMatch[1].toLowerCase();
    return {
      raw,
      normalized: cleanId,
      converted: cleanId,
      wasConverted: cleanId !== raw,
      reason: '動画/生放送IDを抽出',
      alternatives: []
    };
  }

  const normalized = normalizeHalfWidthAndSpaces(raw);
  const compactKey = normalized.toLowerCase().replace(/[\s_-]+/g, '');

  // 1. 辞書ヒット（例: hatsunemiku -> 初音ミク, touhou -> 東方）
  const dictHit = POPULAR_QUERY_DICT[compactKey];
  if (dictHit) {
    const hira = romajiToHiragana(normalized);
    const alts = Array.from(new Set([dictHit, hira, hiraganaToKatakana(hira), normalized])).filter(
      (s) => s && s !== dictHit
    );
    return {
      raw,
      normalized,
      converted: dictHit,
      wasConverted: dictHit !== raw,
      reason: 'キーワード変換',
      alternatives: alts.slice(0, 3)
    };
  }

  // 2. 純粋なローマ字入力をひらがな・カタカナに変換（例: chiruno -> チルノ / ちるの）
  const isPureAsciiLetters = /^[a-zA-Z\s-]+$/.test(normalized) && normalized.length >= 3;
  if (isPureAsciiLetters) {
    const tokens = normalized.split(' ').map((tok) => {
      const k = tok.toLowerCase();
      if (POPULAR_QUERY_DICT[k]) return POPULAR_QUERY_DICT[k];
      const hira = romajiToHiragana(tok);
      // すべてひらがな/記号に変換できた場合のみ適用
      if (!/[a-zA-Z]/.test(hira)) {
        return hira;
      }
      return tok;
    });
    const convertedTokens = tokens.join(' ').trim();
    if (convertedTokens !== normalized && !/[a-zA-Z]/.test(convertedTokens)) {
      const kata = hiraganaToKatakana(convertedTokens);
      return {
        raw,
        normalized,
        converted: convertedTokens,
        wasConverted: true,
        reason: 'ローマ字→かな変換',
        alternatives: Array.from(new Set([kata, normalized])).filter((s) => s && s !== convertedTokens)
      };
    }
  }

  // 3. 半角カナ・全角英数正規化 + ひらがな/カタカナ候補提案
  const alts: string[] = [];
  if (/[\u3041-\u3096]/.test(normalized)) {
    const kata = hiraganaToKatakana(normalized);
    if (kata !== normalized) alts.push(kata);
  } else if (/[\u30a1-\u30f6]/.test(normalized)) {
    const hira = katakanaToHiragana(normalized);
    if (hira !== normalized) alts.push(hira);
  }

  return {
    raw,
    normalized,
    converted: normalized,
    wasConverted: normalized !== raw,
    reason: normalized !== raw ? '表記正規化' : undefined,
    alternatives: alts
  };
}
