const WORDS = `the be of and a to in he have it that for they with as not on she at by this we you do but from or which one would all will there say who make when can more if no man out other so what time up go about than into could state only new year some take come these know see use get like then first any work now may such give over think most even find day also after way many must look before great back through long where much should well people down own just because good each those feel seem how high too place little world very still nation hand old life tell write become here show house both between need mean call develop under last right move thing general school never same another begin while number part turn real leave might want point form off child few small since against ask late home interest large person end open public follow during present without again hold govern around possible head consider word program problem however lead system set order eye plan run keep face fact group play stand increase early course change help line`.split(" ");

export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HARD_WORDS = `ability absolute academic accident according account achieve acquire activity actually addition address adequate advantage afternoon agreement although analysis announce anything apparent approach argument article assemble attention audience authority available awareness background balance beautiful behaviour benefit boundary breakfast brilliant building business calendar campaign capacity category ceremony challenge champion character chemical circumstance collection commercial committee community competition complete condition conference confidence consider construct continue contribute conversation crystal currency customer database decision definitely delivery democracy describe determine difference difficult direction discovery distance document economy education effective electric element emergency employee encourage engineer entirely environment equipment especially establish everything evidence exercise experience explanation expression facility familiar favourite festival financial following foundation frequency function generation government guarantee happiness headline highlight historical hospital identity imagine important increase independent industry influence information initial instance interest interview investment journey judgement keyboard knowledge landscape language leadership literature location machine magazine maintain majority management marketing material measure medicine membership message midnight minimum moment motorway mountain national natural negative network northern objective obviously occasion official operation opinion opportunity organise original otherwise paragraph particular passenger performance personal perspective physical platform political population position positive possible potential practical prepare president pressure previous primary priority probably procedure produce professional programme progress property proposal protection provide purchase quality quarter question reaction recognise recommend reference regional relationship remember represent research resource response restaurant revolution scientific secretary security sentence separate sequence significant situation software solution something southern specific standard strategy strength structure struggle subject success suddenly suggest summary surface surprise technology telephone temperature territory thousand throughout together tomorrow tradition training transfer transport triangle understand universe vacation valuable variety vehicle velocity versus vertical victory village violence visible volume weather weekend whatever wireless without yourself`.split(" ");

const EASY_WORDS = WORDS.filter((w) => w.length <= 5);

export type TextDifficulty = "easy" | "normal" | "hard";

export function generateText(seed: number, difficulty: TextDifficulty = "normal", count = 400) {
  const rand = mulberry32(seed);
  const out: string[] = [];
  while (out.length < count) {
    const pool = difficulty === "easy" ? EASY_WORDS : difficulty === "hard" && rand() < 0.5 ? HARD_WORDS : WORDS;
    let word = pool[Math.floor(rand() * pool.length)]!;
    if (word === out[out.length - 1]) continue;
    if (difficulty === "hard") {
      if (rand() < 0.2) word = word[0]!.toUpperCase() + word.slice(1);
      const r = rand();
      if (r < 0.08) word += ",";
      else if (r < 0.13) word += ".";
    }
    out.push(word);
  }
  return out.join(" ");
}
