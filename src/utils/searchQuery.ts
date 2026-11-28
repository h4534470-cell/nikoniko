// 日本語検索変換ユーティリティ（全角半角・半角カナ・ローマ字→かな/カナ・かな漢字/ニコニコ頻出語変換）

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
  ['ltsu', 'っ'], ['xtsu', 'っ'],
  ['kya', 'きゃ'], ['kyi', 'きぃ'], ['kyu', 'きゅ'], ['kye', 'きぇ'], ['kyo', 'きょ'],
  ['gya', 'ぎゃ'], ['gyi', 'ぎぃ'], ['gyu', 'ぎゅ'], ['gye', 'ぎぇ'], ['gyo', 'ぎょ'],
  ['sha', 'しゃ'], ['shi', 'し'], ['shu', 'しゅ'], ['she', 'しぇ'], ['sho', 'しょ'],
  ['sya', 'しゃ'], ['syi', 'しぃ'], ['syu', 'しゅ'], ['sye', 'しぇ'], ['syo', 'しょ'],
  ['cha', 'ちゃ'], ['chi', 'ち'], ['chu', 'ちゅ'], ['che', 'ちぇ'], ['cho', 'ちょ'],
  ['tya', 'ちゃ'], ['tyi', 'ちぃ'], ['tyu', 'ちゅ'], ['tye', 'ちぇ'], ['tyo', 'ちょ'],
  ['cya', 'ちゃ'], ['cyi', 'ちぃ'], ['cyu', 'ちゅ'], ['cye', 'ちぇ'], ['cyo', 'ちょ'],
  ['tha', 'てゃ'], ['thi', 'てぃ'], ['thu', 'てゅ'], ['the', 'てぇ'], ['tho', 'てょ'],
  ['dha', 'でゃ'], ['dhi', 'でぃ'], ['dhu', 'でゅ'], ['dhe', 'でぇ'], ['dho', 'でょ'],
  ['dya', 'ぢゃ'], ['dyi', 'ぢぃ'], ['dyu', 'ぢゅ'], ['dye', 'ぢぇ'], ['dyo', 'ぢょ'],
  ['tsa', 'つぁ'], ['tsi', 'つぃ'], ['tsu', 'つ'], ['tse', 'つぇ'], ['tso', 'つぉ'],
  ['nya', 'にゃ'], ['nyi', 'にぃ'], ['nyu', 'にゅ'], ['nye', 'にぇ'], ['nyo', 'にょ'],
  ['hya', 'ひゃ'], ['hyi', 'ひぃ'], ['hyu', 'ひゅ'], ['hye', 'ひぇ'], ['hyo', 'ひょ'],
  ['mya', 'みゃ'], ['myi', 'みぃ'], ['myu', 'みゅ'], ['mye', 'みぇ'], ['myo', 'みょ'],
  ['rya', 'りゃ'], ['ryi', 'りぃ'], ['ryu', 'りゅ'], ['rye', 'りぇ'], ['ryo', 'りょ'],
  ['jya', 'じゃ'], ['jyi', 'じぃ'], ['jyu', 'じゅ'], ['jye', 'じぇ'], ['jyo', 'じょ'],
  ['zya', 'じゃ'], ['zyi', 'じぃ'], ['zyu', 'じゅ'], ['zye', 'じぇ'], ['zyo', 'じょ'],
  ['bya', 'びゃ'], ['byi', 'びぃ'], ['byu', 'びゅ'], ['bye', 'びぇ'], ['byo', 'びょ'],
  ['pya', 'ぴゃ'], ['pyi', 'ぴぃ'], ['pyu', 'ぴゅ'], ['pye', 'ぴぇ'], ['pyo', 'ぴょ'],
  ['fya', 'ふゃ'], ['fyi', 'ふぃ'], ['fyu', 'ふゅ'], ['fye', 'ふぇ'], ['fyo', 'ふょ'],
  ['vya', 'ゔゃ'], ['vyi', 'ゔぃ'], ['vyu', 'ゔゅ'], ['vye', 'ゔぇ'], ['vyo', 'ゔょ'],
  ['wha', 'うぁ'], ['whi', 'うぃ'], ['whu', 'う'], ['whe', 'うぇ'], ['who', 'うぉ'],
  ['lya', 'ゃ'], ['lyi', 'ぃ'], ['lyu', 'ゅ'], ['lye', 'ぇ'], ['lyo', 'ょ'],
  ['xya', 'ゃ'], ['xyi', 'ぃ'], ['xyu', 'ゅ'], ['xye', 'ぇ'], ['xyo', 'ょ'],
  ['lwa', 'ゎ'], ['xwa', 'ゎ'], ['ltu', 'っ'], ['xtu', 'っ'],
  ['kwa', 'くぁ'], ['gwa', 'ぐぁ'],
  ['ja', 'じゃ'], ['ji', 'じ'], ['ju', 'じゅ'], ['je', 'じぇ'], ['jo', 'じょ'],
  ['fa', 'ふぁ'], ['fi', 'ふぃ'], ['fu', 'ふ'], ['fe', 'ふぇ'], ['fo', 'ふぉ'],
  ['va', 'ゔぁ'], ['vi', 'ゔぃ'], ['vu', 'ゔ'], ['ve', 'ゔぇ'], ['vo', 'ゔぉ'],
  ['wi', 'うぃ'], ['we', 'うぇ'],
  ['ka', 'か'], ['ki', 'き'], ['ku', 'く'], ['ke', 'け'], ['ko', 'こ'],
  ['sa', 'さ'], ['si', 'し'], ['su', 'す'], ['se', 'せ'], ['so', 'そ'],
  ['ta', 'た'], ['ti', 'ち'], ['tu', 'つ'], ['te', 'て'], ['to', 'と'],
  ['na', 'な'], ['ni', 'に'], ['nu', 'ぬ'], ['ne', 'ね'], ['no', 'の'],
  ['ha', 'は'], ['hi', 'ひ'], ['hu', 'ふ'], ['he', 'へ'], ['ho', 'ほ'],
  ['ma', 'ま'], ['mi', 'み'], ['mu', 'む'], ['me', 'め'], ['mo', 'も'],
  ['ya', 'や'], ['yi', 'い'], ['yu', 'ゆ'], ['ye', 'いぇ'], ['yo', 'よ'],
  ['ra', 'ら'], ['ri', 'り'], ['ru', 'る'], ['re', 'れ'], ['ro', 'ろ'],
  ['wa', 'わ'], ['wo', 'を'],
  ['ga', 'が'], ['gi', 'ぎ'], ['gu', 'ぐ'], ['ge', 'げ'], ['go', 'ご'],
  ['za', 'ざ'], ['zi', 'じ'], ['zu', 'ず'], ['ze', 'ぜ'], ['zo', 'ぞ'],
  ['da', 'だ'], ['di', 'ぢ'], ['du', 'づ'], ['de', 'で'], ['do', 'ど'],
  ['ba', 'ば'], ['bi', 'び'], ['bu', 'ぶ'], ['be', 'べ'], ['bo', 'ぼ'],
  ['pa', 'ぱ'], ['pi', 'ぴ'], ['pu', 'ぷ'], ['pe', 'ぺ'], ['po', 'ぽ'],
  ['la', 'ぁ'], ['li', 'ぃ'], ['lu', 'ぅ'], ['le', 'ぇ'], ['lo', 'ぉ'],
  ['xa', 'ぁ'], ['xi', 'ぃ'], ['xu', 'ぅ'], ['xe', 'ぇ'], ['xo', 'ぉ'],
  ['a', 'あ'], ['i', 'い'], ['u', 'う'], ['e', 'え'], ['o', 'お'],
  ['-', 'ー'], ['~', '〜']
];

// ローマ字・ひらがな・カタカナ・英語略称 -> 公式表記 / 漢字表記辞書
const POPULAR_QUERY_DICT: Record<string, string> = {
  // ボカロ・合成音声・楽曲
  bokaro: 'ボカロ', 'ぼかろ': 'ボカロ',
  bokaroido: 'VOCALOID', 'ぼかろいど': 'VOCALOID', vocaloid: 'VOCALOID',
  hatsunemiku: '初音ミク', hatunemiku: '初音ミク', 'はつねみく': '初音ミク',
  miku: '初音ミク', 'みく': '初音ミク', miku39: '初音ミク',
  kagaminerin: '鏡音リン', 'かがみねりん': '鏡音リン',
  kagaminelen: '鏡音レン', 'かがみねれん': '鏡音レン',
  megurineluka: '巡音ルカ', 'めぐりねるか': '巡音ルカ',
  kaito: 'KAITO', meiko: 'MEIKO',
  kasaneteto: '重音テト', 'かさねてと': '重音テト', teto: '重音テト',
  zundamon: 'ずんだもん', 'ずんだもん': 'ずんだもん',
  senbonzakura: '千本桜', 'せんぼんざくら': '千本桜',
  badapple: 'Bad Apple!!',
  kyoufuuallback: '強風オールバック', kyoufuu: '強風オールバック', 'きょうふうおーるばっく': '強風オールバック',
  aidoru: 'アイドル', idol: 'アイドル', 'あいどる': 'アイドル',
  mezumaraiza: 'メズマライザー', mesmerizer: 'メズマライザー', 'めずまらいざー': 'メズマライザー',
  monitaringu: 'モニタリング', monitoring: 'モニタリング',
  shoushitsu: '初音ミクの消失', 'しょうしつ': '初音ミクの消失',
  rollinggirl: 'ローリンガール', 'ろーりんがーる': 'ローリンガール',
  roki: 'ロキ', 'ろき': 'ロキ',
  king: 'KING',
  voiceroid: 'VOICEROID', 'ぼいすろいど': 'VOICEROID',
  voicevox: 'VOICEVOX', 'ぼいすぼっくす': 'VOICEVOX',
  cevio: 'CeVIO', synthesizerv: 'Synthesizer V',
  kotonoha: '琴葉姉妹', 'ことのはしまい': '琴葉姉妹',
  yukari: '結月ゆかり', yudukiyukari: '結月ゆかり', 'ゆづきゆかり': '結月ゆかり',
  akane: '琴葉茜', aoi: '琴葉葵',

  // アーティスト・グループ
  yorushika: 'ヨルシカ', 'よるしか': 'ヨルシカ',
  yoasobi: 'YOASOBI', 'よあそび': 'YOASOBI',
  zutomayo: 'ずっと真夜中でいいのに', 'ずとまよ': 'ずっと真夜中でいいのに',
  ado: 'Ado',
  kessoku: '結束バンド', kessokubando: '結束バンド', 'けっそくばんど': '結束バンド',
  bocchitherock: 'ぼっち・ざ・ろっく', bocchi: 'ぼっち・ざ・ろっく', 'ぼっちざろっく': 'ぼっち・ざ・ろっく',
  kenshiyonezu: '米津玄師', yonezu: '米津玄師', 'よねづけんし': '米津玄師',
  hachi: 'ハチ', wowaka: 'wowaka', deco27: 'DECO*27',
  kairikibear: 'かいりきベア', kairiki: 'かいりきベア', 'かいりきべあ': 'かいりきベア',
  nayutan: 'ナユタン星人', 'なゆたんせいじん': 'ナユタン星人',
  pinocchiop: 'ピノキオピー', 'ぴのきおぴー': 'ピノキオピー',
  iyowa: 'いよわ', 'いよわ': 'いよわ',
  kanaria: 'Kanaria',

  // 東方・ニコニコ定番・アニメ・ゲーム・VTuber
  touhou: '東方', toho: '東方', 'とうほう': '東方',
  chirno: 'チルノ', chiruno: 'チルノ', 'ちるの': 'チルノ',
  onmyouji: '陰陽師', onmyoji: '陰陽師', 'おんみょうじ': '陰陽師',
  kumikyoku: '組曲『ニコニコ動画』', 'くみきょく': '組曲『ニコニコ動画』',
  ryuuseigun: 'ニコニコ動画流星群', 'りゅうせいぐん': 'ニコニコ動画流星群',
  reimu: '博麗霊夢', 'れいむ': '霊夢',
  marisa: '霧雨魔理沙', 'まりさ': '魔理沙',
  maikura: 'マインクラフト', minecraft: 'Minecraft', 'まいくら': 'マイクラ',
  umamusume: 'ウマ娘', 'うまむすめ': 'ウマ娘',
  genshin: '原神', 'げんしん': '原神',
  puroseka: 'プロセカ', proseka: 'プロセカ', 'ぷろせか': 'プロセカ',
  buruaaka: 'ブルアカ', bluearchive: 'ブルーアーカイブ', 'ぶるあか': 'ブルアカ',
  shingeki: '進撃の巨人', shingekinokyojin: '進撃の巨人', 'しんげきのきょじん': '進撃の巨人',
  kimetsu: '鬼滅の刃', kimetsunoyaiba: '鬼滅の刃', 'きめつのやいば': '鬼滅の刃',
  jujutsu: '呪術廻戦', jujutsukaisen: '呪術廻戦', 'じゅじゅつかいせん': '呪術廻戦',
  chainsawman: 'チェンソーマン', 'ちぇんそーまん': 'チェンソーマン',
  oshinoko: '推しの子', 'おしのこ': '推しの子',
  dandadan: 'ダンダダン', 'だんだだん': 'ダンダダン',
  gintama: '銀魂', 'ぎんたま': '銀魂',
  jojo: 'ジョジョの奇妙な冒険', 'じょじょ': 'ジョジョ',
  pokemon: 'ポケモン', 'ぽけもん': 'ポケモン',
  sumabura: 'スマブラ', 'すまぶら': 'スマブラ',
  splatoon: 'スプラトゥーン', supura: 'スプラトゥーン', 'すぷらとぅーん': 'スプラトゥーン',
  nijisanji: 'にじさんじ', 'にじさんじ': 'にじさんじ',
  hololive: 'ホロライブ', hororaibu: 'ホロライブ', 'ほろらいぶ': 'ホロライブ',
  vspo: 'ぶいすぽっ！', buisupo: 'ぶいすぽっ！', 'ぶいすぽ': 'ぶいすぽっ！',
  ryouri: '料理', 'りょうり': '料理',
  raamen: 'ラーメン', ramen: 'ラーメン', 'らーめん': 'ラーメン',
  bgm: '作業用BGM', sagyoubgm: '作業用BGM', sagyobgm: '作業用BGM', 'さぎょうようbgm': '作業用BGM', 'さぎょうよう': '作業用BGM',
  mad: '音MAD', otomad: '音MAD', 'おとmad': '音MAD', 'おとまっど': '音MAD',
  yukkuri: 'ゆっくり解説', 'ゆっくりかいせつ': 'ゆっくり解説',
  yukkurijikkyou: 'ゆっくり実況', 'ゆっくりじっきょう': 'ゆっくり実況',
  jikkyou: '実況プレイ', 'じっきょう': '実況プレイ', 'じっきょうぷれい': '実況プレイ',
  rta: 'RTA', 'あーるてぃーえー': 'RTA',
  utattemita: '歌ってみた', 'うたってみた': '歌ってみた',
  odottemita: '踊ってみた', 'おどってみた': '踊ってみた',
  ensou: '演奏してみた', ensoushitemita: '演奏してみた', 'えんそうしてみた': '演奏してみた',
  tsukuttemita: '作ってみた', 'つくってみた': '作ってみた',
  nikoniko: 'ニコニコ', niconico: 'ニコニコ', 'にこにこ': 'ニコニコ',
  douga: '動画', 'どうが': '動画',
  ongaku: '音楽', 'おんがく': '音楽',
  anime: 'アニメ', 'あにめ': 'アニメ',
  geemu: 'ゲーム', game: 'ゲーム', 'げーむ': 'ゲーム',
  kyoku: '曲', 'きょく': '曲',
  meikyoku: '名曲', 'めいきょく': '名曲',
  kawaii: 'かわいい', 'かわいい': 'かわいい',
  omoshiro: 'おもしろ', 'おもしろ': 'おもしろ',
  nyanko: '猫', neko: '猫', 'ねこ': '猫',
  inu: '犬', 'いぬ': '犬',
  mmd: 'MMD',
  vtuber: 'VTuber',
  nama: '生放送', namahousou: '生放送', 'なまほうそう': '生放送'
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

    // 1. "n'" -> ん
    if (src.startsWith("n'", i)) {
      out += 'ん';
      i += 2;
      continue;
    }

    // 2. "nn" 処理: 直後が母音または y の場合は最初の n だけを「ん」にして次を na/ni/nu/ne/no/nya 等で変換
    //    例: minna -> みんな, konnichiwa -> こんにちわ, kinnyou -> きんよう
    if (src.startsWith('nn', i)) {
      const after = src[i + 2];
      if (after && 'aiueoy'.includes(after)) {
        out += 'ん';
        i += 1;
      } else {
        out += 'ん';
        i += 2;
      }
      continue;
    }

    // 3. 促音（連続子音 kk, tt, pp, ss 等、n/a/i/u/e/o 以外）
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

    // 4. 最長一致テーブル
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

    // 5. 単一 n が子音・末尾・記号の前なら「ん」
    if (ch === 'n') {
      const next = src[i + 1];
      if (!next || (!'aiueoy'.includes(next) && next !== 'n')) {
        out += 'ん';
        i += 1;
        continue;
      }
    }

    // 6. ヘボン式 m + b/p -> ん (例: sempai -> せんぱい, namba -> なんば)
    if (ch === 'm') {
      const next = src[i + 1];
      if (next === 'b' || next === 'p') {
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

/**
 * 入力文字列（ローマ字・ひらがな・カタカナ混在可）をIMEAPI用のひらがなへ整える
 * 入力途中の末尾子音（例: hatsunem -> はつね）も落として途中変換できるようにする
 */
export function toSearchHiragana(rawInput: string): string {
  const normalized = normalizeHalfWidthAndSpaces(rawInput);
  if (!normalized) return '';
  return normalized
    .split(' ')
    .map((tok) => {
      if (/^[a-zA-Z0-9~'-]+$/.test(tok)) {
        const h = romajiToHiragana(tok);
        if (!/[a-zA-Z]/.test(h)) return h;
        const partial = h.replace(/[a-z]{1,3}$/i, '');
        if (/[\u3041-\u3096]/.test(partial) && !/[a-zA-Z]/.test(partial)) {
          return partial;
        }
      }
      return katakanaToHiragana(tok);
    })
    .filter(Boolean)
    .join(' ');
}

const POPULAR_EXTRA_SUGGESTIONS: Array<{ keys: string[]; label: string }> = [
  { keys: ['miku', 'hatsunemiku', 'みく', 'はつね', '初音ミク'], label: '初音ミク オリジナル曲' },
  { keys: ['miku', 'hatsunemiku', 'みく', 'はつね', '初音ミク'], label: '初音ミク ライブ' },
  { keys: ['miku', 'hatsunemiku', 'みく', 'はつね', '初音ミク'], label: '初音ミク ランキング' },
  { keys: ['bokaro', 'vocaloid', 'ぼかろ', 'ボカロ'], label: 'ボカロ神曲' },
  { keys: ['bokaro', 'vocaloid', 'ぼかろ', 'ボカロ'], label: 'ボカロメドレー' },
  { keys: ['bokaro', 'vocaloid', 'ぼかろ', 'ボカロ'], label: 'ボカロオリジナル曲' },
  { keys: ['bokaro', 'vocaloid', 'ぼかろ', 'ボカロ'], label: 'ボカロランキング' },
  { keys: ['touhou', 'toho', 'とうほう', '東方'], label: '東方Project' },
  { keys: ['touhou', 'toho', 'とうほう', '東方'], label: '東方Vocal' },
  { keys: ['touhou', 'toho', 'とうほう', '東方'], label: '東方アレンジ' },
  { keys: ['touhou', 'toho', 'とうほう', '東方'], label: '東方MMD' },
  { keys: ['jikkyou', 'geemu', 'game', 'じっきょう', 'げーむ', '実況', 'ゲーム'], label: 'ゲーム実況' },
  { keys: ['jikkyou', 'yukkuri', 'じっきょう', 'ゆっくり', '実況'], label: 'ゆっくり実況' },
  { keys: ['yukkuri', 'ゆっくり', '解説'], label: 'ゆっくり解説' },
  { keys: ['uta', 'utattemita', 'うた', '歌'], label: '歌ってみた' },
  { keys: ['odoru', 'odottemita', 'おど', '踊'], label: '踊ってみた' },
  { keys: ['bgm', 'sagyou', 'さぎょう', '作業'], label: '作業用BGM' },
  { keys: ['mad', 'otomad', 'おとま', '音'], label: '音MAD' },
  { keys: ['omoshiro', 'douga', 'おもしろ', 'どうが'], label: 'おもしろ動画' },
  { keys: ['anime', 'あにめ', 'アニメ'], label: 'アニメ OP' },
  { keys: ['anime', 'あにめ', 'アニメ'], label: 'アニメ 名シーン' },
  { keys: ['maikura', 'minecraft', 'まいくら', 'マイクラ'], label: 'マインクラフト 実況' },
  { keys: ['zundamon', 'ずんだもん', 'ずんだ'], label: 'ずんだもん 実況' },
  { keys: ['zundamon', 'ずんだもん', 'ずんだ'], label: 'ずんだもん 解説' },
  { keys: ['nama', 'namahousou', 'なま', '生'], label: '生放送 アーカイブ' }
];

export function getLocalSearchSuggestions(rawInput: string, limit: number = 10): string[] {
  const normalized = normalizeHalfWidthAndSpaces(rawInput);
  if (!normalized) return [];
  const compactLow = normalized.toLowerCase().replace(/[\s_-]+/g, '');
  const hiraFull = toSearchHiragana(normalized);
  const hiraCompact = hiraFull.replace(/[\s・_-]+/g, '');
  const kataCompact = hiraganaToKatakana(hiraCompact);

  const results: string[] = [];
  const seen = new Set<string>();
  const push = (val: string) => {
    const clean = String(val || '').trim();
    if (!clean || clean === normalized || seen.has(clean)) return;
    seen.add(clean);
    results.push(clean);
  };

  // 1. Exact & prefix match against POPULAR_QUERY_DICT
  for (const [k, v] of Object.entries(POPULAR_QUERY_DICT)) {
    const kLow = k.toLowerCase();
    const vLow = v.toLowerCase();
    if (
      kLow === compactLow ||
      kLow === hiraCompact ||
      (compactLow.length >= 2 && (kLow.startsWith(compactLow) || vLow.startsWith(compactLow))) ||
      (hiraCompact.length >= 2 && (kLow.startsWith(hiraCompact) || v.startsWith(hiraCompact) || v.startsWith(kataCompact)))
    ) {
      push(v);
      if (results.length >= limit) return results;
    }
  }

  // 2. Compound curated Niconico suggestions
  for (const entry of POPULAR_EXTRA_SUGGESTIONS) {
    if (
      entry.keys.some(
        (k) =>
          (compactLow.length >= 2 && (k.startsWith(compactLow) || compactLow.includes(k))) ||
          (hiraCompact.length >= 2 && (k.startsWith(hiraCompact) || hiraCompact.includes(k))) ||
          entry.label.toLowerCase().includes(compactLow)
      )
    ) {
      push(entry.label);
      if (results.length >= limit) return results;
    }
  }

  // 3. Partial romaji -> hiragana + katakana
  if (hiraFull && hiraFull !== normalized && !/[a-zA-Z]/.test(hiraFull)) {
    push(hiraFull);
    const kata = hiraganaToKatakana(hiraFull);
    if (kata !== hiraFull) push(kata);
  }

  return results.slice(0, limit);
}

// 読み(ひらがな) -> 漢字候補リスト（同音異義語・複合語分割対応）
const KANJI_CONVERSION_DICT: Record<string, string[]> = {
  'かんじ': ['漢字', '感じ', '幹事', '監事'],
  'へんかん': ['変換', '返還'],
  'けんさく': ['検索', '研削'],
  'にほん': ['日本', '二本'],
  'にっぽん': ['日本'],
  'にほんご': ['日本語'],
  'せかい': ['世界'],
  'どうが': ['動画'],
  'おんがく': ['音楽'],
  'おもしろ': ['面白'],
  'おもしろい': ['面白い'],
  'かみ': ['神', '紙', '髪'],
  'かみきょく': ['神曲'],
  'かみかい': ['神回'],
  'めいきょく': ['名曲'],
  'めいさく': ['名作'],
  'しんさく': ['新作'],
  'でんせつ': ['伝説'],
  'さいきょう': ['最強'],
  'さいこう': ['最高'],
  'さいしん': ['最新'],
  'にんき': ['人気'],
  'きょく': ['曲', '局', '極'],
  'うた': ['歌', '詩'],
  'こえ': ['声'],
  'おと': ['音'],
  'あい': ['愛', '相', '藍'],
  'こい': ['恋', '濃い'],
  'ゆめ': ['夢'],
  'そら': ['空'],
  'うみ': ['海'],
  'やま': ['山'],
  'かわ': ['川', '河', '皮'],
  'はな': ['花', '話', '鼻'],
  'ほし': ['星'],
  'つき': ['月'],
  'ゆき': ['雪', '行き'],
  'あめ': ['雨', '飴'],
  'かぜ': ['風', '風邪'],
  'ひかり': ['光'],
  'やみ': ['闇'],
  'かげ': ['影', '陰'],
  'こころ': ['心'],
  'いのち': ['命'],
  'きせき': ['奇跡', '軌跡'],
  'かいせつ': ['解説', '開設'],
  'じっきょう': ['実況'],
  'りょうり': ['料理'],
  'れきし': ['歴史'],
  'かがく': ['科学', '化学'],
  'うちゅう': ['宇宙'],
  'てんし': ['天使'],
  'あくま': ['悪魔'],
  'まほう': ['魔法'],
  'りゅう': ['龍', '竜'],
  'おに': ['鬼'],
  'けん': ['剣', '犬', '県'],
  'ねこ': ['猫'],
  'いぬ': ['犬'],
  'とり': ['鳥'],
  'さかな': ['魚'],
  'さくら': ['桜'],
  'みらい': ['未来'],
  'かこ': ['過去'],
  'げんざい': ['現在'],
  'じかん': ['時間'],
  'うんめい': ['運命'],
  'しんじつ': ['真実'],
  'きぼう': ['希望'],
  'ゆうき': ['勇気'],
  'ちから': ['力'],
  'たたかい': ['戦い'],
  'たび': ['旅'],
  'みち': ['道'],
  'ことば': ['言葉'],
  'なまえ': ['名前'],
  'ともだち': ['友達'],
  'かぞく': ['家族'],
  'せんせい': ['先生'],
  'がっこう': ['学校'],
  'しごと': ['仕事'],
  'きょう': ['今日', '京'],
  'あした': ['明日'],
  'きのう': ['昨日'],
  'よる': ['夜'],
  'あさ': ['朝'],
  'はる': ['春'],
  'なつ': ['夏'],
  'あき': ['秋'],
  'ふゆ': ['冬'],
  'あお': ['青'],
  'あか': ['赤'],
  'しろ': ['白'],
  'くろ': ['黒'],
  'きん': ['金'],
  'ぎん': ['銀'],
  'にじ': ['虹'],
  'かお': ['顔'],
  'て': ['手'],
  'め': ['目', '芽'],
  'ゆび': ['指'],
  'つばさ': ['翼'],
  'かぎ': ['鍵'],
  'とびら': ['扉'],
  'かめん': ['仮面'],
  'きおく': ['記憶'],
  'やくそく': ['約束'],
  'えがお': ['笑顔'],
  'なみだ': ['涙'],
  'せいしゅん': ['青春'],
  'そつぎょう': ['卒業'],
  'ぼうけん': ['冒険'],
  'ゆうしゃ': ['勇者'],
  'まおう': ['魔王'],
  'しゅじんこう': ['主人公'],
  'てき': ['敵'],
  'みかた': ['味方'],
  'しょうり': ['勝利'],
  'まつり': ['祭り'],
  'はなび': ['花火'],
  'でんしゃ': ['電車'],
  'くるま': ['車'],
  'ひこうき': ['飛行機'],
  'ふね': ['船'],
  'とうきょう': ['東京'],
  'おおさか': ['大阪'],
  'きょうと': ['京都'],
  'ほっかいどう': ['北海道'],
  'おきなわ': ['沖縄'],
  'ふじさん': ['富士山'],
  'しんじゅく': ['新宿'],
  'しぶや': ['渋谷'],
  'あきはばら': ['秋葉原'],
  'いけぶくろ': ['池袋'],
  'じんせい': ['人生'],
  'しょうらい': ['将来'],
  'げんき': ['元気'],
  'びょうき': ['病気'],
  'あんぜん': ['安全'],
  'きけん': ['危険'],
  'へいわ': ['平和'],
  'せんそう': ['戦争'],
  'じゆう': ['自由'],
  'せいぎ': ['正義'],
  'しんらい': ['信頼'],
  'へんしゅう': ['編集'],
  'とうこう': ['投稿'],
  'はいしん': ['配信'],
  'ほうそう': ['放送'],
  'なまほうそう': ['生放送'],
  'さいせい': ['再生'],
  'ざつだん': ['雑談'],
  'そうさく': ['創作'],
  'どうぶつ': ['動物'],
  'しょくぶつ': ['植物'],
  'しぜん': ['自然'],
  'かんきょう': ['環境'],
  'しゃかい': ['社会'],
  'けいざい': ['経済'],
  'せいじ': ['政治'],
  'ぶんか': ['文化'],
  'げいじゅつ': ['芸術'],
  'びじゅつ': ['美術'],
  'えいが': ['映画'],
  'しょうせつ': ['小説'],
  'まんが': ['漫画'],
  'せいゆう': ['声優'],
  'かんどう': ['感動'],
  'きょうふ': ['恐怖'],
  'しんぴ': ['神秘'],
  'ふしぎ': ['不思議'],
  'ひみつ': ['秘密'],
  'ちしき': ['知識'],
  'ぎじゅつ': ['技術'],
  'きかい': ['機械', '機会'],
  'でんき': ['電気'],
  'ちきゅう': ['地球'],
  'たいよう': ['太陽'],
  'かみさま': ['神様'],
  'おおかみ': ['狼', '大神'],
  'きつね': ['狐'],
  'たぬき': ['狸'],
  'うさぎ': ['兎'],
  'くま': ['熊'],
  'とら': ['虎'],
  'へび': ['蛇'],
  'かえる': ['蛙', '帰る'],
  'てんき': ['天気'],
  'たいふう': ['台風'],
  'じしん': ['地震', '自信'],
  'かみなり': ['雷'],
  'つなみ': ['津波'],
  'ほのお': ['炎'],
  'こおり': ['氷'],
  'もり': ['森'],
  'はやし': ['林'],
  'しま': ['島'],
  'みなと': ['港'],
  'しろい': ['白い'],
  'くろい': ['黒い'],
  'あかい': ['赤い'],
  'あおい': ['青い'],
  'たかい': ['高い'],
  'やすい': ['安い'],
  'ひろい': ['広い'],
  'ながい': ['長い'],
  'おおきい': ['大きい'],
  'ちいさい': ['小さい'],
  'あたらしい': ['新しい'],
  'ふるい': ['古い'],
  'はやい': ['速い', '早い'],
  'おそい': ['遅い'],
  'つよい': ['強い'],
  'よわい': ['弱い'],
  'たのしい': ['楽しい'],
  'うれしい': ['嬉しい'],
  'かなしい': ['悲しい'],
  'さびしい': ['寂しい'],
  'こわい': ['怖い'],
  'すごい': ['凄い'],
  'うつくしい': ['美しい'],
  'やさしい': ['優しい', '易しい'],
  'むずかしい': ['難しい'],
  'たいせつ': ['大切'],
  'だいすき': ['大好き'],
  'すき': ['好き'],
  'きらい': ['嫌い'],
  'まじ': ['本気'],
  'ほんき': ['本気'],
  'ほんとう': ['本当'],
  'うそ': ['嘘'],
  'しょうかい': ['紹介'],
  'じっけん': ['実験'],
  'けんしょう': ['検証'],
  'こうざ': ['講座'],
  'さんぽ': ['散歩'],
  'りょこう': ['旅行'],
  'べんきょう': ['勉強'],
  'しゅみ': ['趣味'],
  'しゅぎょう': ['修行'],
  'けっこん': ['結婚'],
  'たんじょうび': ['誕生日'],
  'みんな': ['皆', 'みんな'],
  'ぜんぶ': ['全部'],
  'さいご': ['最後'],
  'さいしょ': ['最初'],
  'はじめ': ['初め', '始め'],
  'おわり': ['終わり'],
  'つづき': ['続き'],
  'いちばん': ['一番'],
  'とくしゅう': ['特集'],
  'きねん': ['記念'],
  'ほぞん': ['保存'],
  'しちょう': ['視聴'],
  'とうろく': ['登録'],
  'せってい': ['設定'],
  'じどう': ['自動'],
  'しゅどう': ['手動'],
  'こうしき': ['公式'],
  'ゆうめい': ['有名'],
  'わだい': ['話題'],
  'しんき': ['新規'],
  'かぞえうた': ['数え歌']
};

function convertHiraCompoundGreedy(hiraChunk: string): string | null {
  if (!hiraChunk || !/[\u3041-\u3096]/.test(hiraChunk)) return null;
  let pos = 0;
  let out = '';
  let convertedAny = false;

  while (pos < hiraChunk.length) {
    let bestLen = 0;
    let bestWord = '';
    const maxLen = Math.min(12, hiraChunk.length - pos);
    for (let len = maxLen; len >= 2; len--) {
      const sub = hiraChunk.slice(pos, pos + len);
      const kList = KANJI_CONVERSION_DICT[sub];
      if (kList && kList[0]) {
        bestLen = len;
        bestWord = kList[0];
        break;
      }
      const pHit = POPULAR_QUERY_DICT[sub];
      if (pHit) {
        bestLen = len;
        bestWord = pHit;
        break;
      }
    }
    if (bestLen > 0) {
      out += bestWord;
      pos += bestLen;
      convertedAny = true;
    } else {
      out += hiraChunk[pos];
      pos += 1;
    }
  }

  return convertedAny && out !== hiraChunk ? out : null;
}

export function getLocalKanjiCandidates(rawInput: string, limit: number = 8): string[] {
  const normalized = normalizeHalfWidthAndSpaces(rawInput);
  if (!normalized) return [];
  const hiraFull = toSearchHiragana(normalized);
  if (!hiraFull) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const clean = String(s || '').trim();
    if (!clean || clean === normalized || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  const hiraCompact = hiraFull.replace(/\s+/g, '');
  // 1. 完全一致する同音異義語を全展開
  if (KANJI_CONVERSION_DICT[hiraCompact]) {
    KANJI_CONVERSION_DICT[hiraCompact].forEach(push);
  }

  // 2. スペース区切り・複合語を最長一致で漢字変換
  const tokens = hiraFull.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const mappedTokens = tokens.map((t) => {
      if (KANJI_CONVERSION_DICT[t]?.[0]) return KANJI_CONVERSION_DICT[t][0];
      if (POPULAR_QUERY_DICT[t]) return POPULAR_QUERY_DICT[t];
      return convertHiraCompoundGreedy(t) || t;
    });
    const joined = mappedTokens.join(' ');
    if (joined !== hiraFull) push(joined);
    const joinedTight = mappedTokens.join('');
    if (joinedTight !== hiraFull) push(joinedTight);
  } else {
    const greedy = convertHiraCompoundGreedy(hiraCompact);
    if (greedy) push(greedy);
  }

  // 3. 読み前方一致（入力途中の漢字予測）
  if (hiraCompact.length >= 2) {
    for (const [reading, kanjiList] of Object.entries(KANJI_CONVERSION_DICT)) {
      if (reading.startsWith(hiraCompact) && reading !== hiraCompact) {
        kanjiList.slice(0, 2).forEach(push);
        if (out.length >= limit) break;
      }
    }
  }

  return out.slice(0, limit);
}

export interface SearchConversionCandidate {
  text: string;
  kind: 'dict' | 'ime' | 'nico' | 'kana' | 'kata' | 'hira';
}

export interface SearchConversionResult {
  raw: string;
  normalized: string;
  hiraText: string;
  converted: string;
  wasConverted: boolean;
  needsRemoteIme: boolean;
  reason?: string;
  alternatives: string[];
}

export function convertSearchQuery(rawInput: string, enabled: boolean = true): SearchConversionResult {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return {
      raw: '',
      normalized: '',
      hiraText: '',
      converted: '',
      wasConverted: false,
      needsRemoteIme: false,
      alternatives: []
    };
  }
  if (!enabled) {
    return {
      raw,
      normalized: raw,
      hiraText: '',
      converted: raw,
      wasConverted: false,
      needsRemoteIme: false,
      alternatives: []
    };
  }

  // URL・ID直打ち時はID抽出を優先
  const idMatch = raw.match(/\b((?:sm|so|nm|lv)\d+)\b/i);
  if (idMatch && (raw.includes('nicovideo') || raw.includes('nico.ms') || /^(sm|so|nm|lv)\d+$/i.test(raw))) {
    const cleanId = idMatch[1].toLowerCase();
    return {
      raw,
      normalized: cleanId,
      hiraText: '',
      converted: cleanId,
      wasConverted: cleanId !== raw,
      needsRemoteIme: false,
      reason: '動画/生放送IDを抽出',
      alternatives: []
    };
  }

  const normalized = normalizeHalfWidthAndSpaces(raw);
  const compactKey = normalized.toLowerCase().replace(/[\s_-]+/g, '');
  const hiraCompact = katakanaToHiragana(normalized).replace(/[\s・_-]+/g, '');

  // 1. 全体一致（辞書ヒット）
  const wholeDictHit = POPULAR_QUERY_DICT[compactKey] || POPULAR_QUERY_DICT[hiraCompact];
  if (wholeDictHit) {
    const hira = /^[a-zA-Z\s'-]+$/.test(normalized)
      ? romajiToHiragana(normalized)
      : katakanaToHiragana(normalized);
    const alts = Array.from(
      new Set([wholeDictHit, hira, hiraganaToKatakana(hira), normalized])
    ).filter((s) => s && s !== wholeDictHit && !/[a-zA-Z]/.test(s) || /^[A-Z0-9\s!*+.&/-]+$/i.test(s));
    return {
      raw,
      normalized,
      hiraText: !/[a-zA-Z]/.test(hira) ? hira : normalized,
      converted: wholeDictHit,
      wasConverted: wholeDictHit !== raw,
      needsRemoteIme: false,
      reason: 'キーワード変換',
      alternatives: alts.slice(0, 4)
    };
  }

  // 2. スペース区切り複数語対応（2語連結辞書 + 単語辞書 + ローマ字→かな）
  const tokens = normalized.split(' ').filter(Boolean);
  const outTokens: string[] = [];
  const hiraTokens: string[] = [];
  let dictMatchedAny = false;
  let romajiConvertedAny = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const nextTok = tokens[i + 1];

    // 2語結合で辞書に当たるか確認 (例: hatsune miku -> 初音ミク, bad apple -> Bad Apple!!)
    if (nextTok) {
      const pairKey = (tok + nextTok).toLowerCase().replace(/[_-]+/g, '');
      const pairHiraKey = katakanaToHiragana(tok + nextTok);
      const pairHit = POPULAR_QUERY_DICT[pairKey] || POPULAR_QUERY_DICT[pairHiraKey];
      if (pairHit) {
        outTokens.push(pairHit);
        hiraTokens.push(katakanaToHiragana(/^[a-zA-Z'-]+$/.test(tok + nextTok) ? romajiToHiragana(tok + ' ' + nextTok) : tok + ' ' + nextTok));
        dictMatchedAny = true;
        i += 1;
        continue;
      }
    }

    const low = tok.toLowerCase();
    const tokHira = katakanaToHiragana(tok);
    const singleHit = POPULAR_QUERY_DICT[low] || POPULAR_QUERY_DICT[tokHira];
    if (singleHit) {
      outTokens.push(singleHit);
      hiraTokens.push(/^[a-zA-Z'-]+$/.test(tok) ? romajiToHiragana(tok) : tokHira);
      dictMatchedAny = true;
      continue;
    }

    if (/^[a-zA-Z'-]+$/.test(tok) && tok.length >= 2) {
      const convertedHira = romajiToHiragana(tok);
      if (!/[a-zA-Z]/.test(convertedHira)) {
        outTokens.push(convertedHira);
        hiraTokens.push(convertedHira);
        romajiConvertedAny = true;
        continue;
      }
    }

    outTokens.push(tok);
    hiraTokens.push(tokHira);
  }

  const combined = outTokens.join(' ').trim();
  const hiraText = hiraTokens.join(' ').trim();
  const hasHiraganaOnly = /[\u3041-\u3096]/.test(combined) && !/[\u4e00-\u9faf]/.test(combined);
  const needsRemoteIme = !dictMatchedAny && (hasHiraganaOnly || romajiConvertedAny);

  const localKanji = !dictMatchedAny ? getLocalKanjiCandidates(combined || hiraText || normalized, 6) : [];
  const primaryConverted = (localKanji[0] && hasHiraganaOnly) ? localKanji[0] : (combined || normalized);

  const alts: string[] = [];
  if (localKanji.length > 0) {
    localKanji.forEach((k) => {
      if (k !== primaryConverted && !alts.includes(k)) alts.push(k);
    });
    if (combined && combined !== primaryConverted && !alts.includes(combined)) alts.push(combined);
  }
  if (/[\u3041-\u3096]/.test(combined)) {
    const kata = hiraganaToKatakana(combined);
    if (kata !== primaryConverted && kata !== raw && !alts.includes(kata)) alts.push(kata);
  }
  if (/[\u30a1-\u30f6]/.test(combined)) {
    const hira = katakanaToHiragana(combined);
    if (hira !== primaryConverted && hira !== raw && !alts.includes(hira)) alts.push(hira);
  }
  if (combined !== normalized && !alts.includes(normalized) && !/^[a-z\s-]+$/i.test(normalized)) {
    alts.push(normalized);
  }

  return {
    raw,
    normalized,
    hiraText,
    converted: primaryConverted,
    wasConverted: primaryConverted !== raw,
    needsRemoteIme,
    reason: dictMatchedAny
      ? 'キーワード変換'
      : (localKanji[0] && hasHiraganaOnly)
        ? '漢字変換'
        : romajiConvertedAny
          ? 'ローマ字→かな変換'
          : normalized !== raw
            ? '表記正規化'
            : undefined,
    alternatives: alts.slice(0, 8)
  };
}
