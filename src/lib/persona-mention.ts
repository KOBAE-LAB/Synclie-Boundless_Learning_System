// F05: 複数の擬似メンバーがいる授業での話者調整(pickRespondingPersona)で使う。
// 学習者はペルソナの正式名(教師が付けた「討論好きの山田くん」のような説明的な名前)を
// 全部書くとは限らず、「山田くん」のような末尾の呼び名だけで名指しすることが多い。
// そのため名前の末尾からの部分一致(3文字以上)で名指しを判定する。
// "use server"ファイル(learn/[courseId]/actions.ts)から使うが、この関数自体は
// async関数ではなくDBにも触れない純粋な文字列判定なので、テストしやすいよう
// 別ファイルに切り出している。
export function isPersonaMentioned(personaName: string, message: string): boolean {
  const MIN_SUFFIX_LEN = 3;
  // 先輩型の名前「2025年度の先輩 ミナト(AI)」は、末尾の「(AI)」を除いて判定する(「ミナト先輩」「ミナトさん」で呼ばれるため)。
  personaName = personaName.replace(/[((]AI[))]$/, "").trim();
  for (let len = personaName.length; len >= MIN_SUFFIX_LEN; len--) {
    if (message.includes(personaName.slice(-len))) return true;
  }
  return false;
}
