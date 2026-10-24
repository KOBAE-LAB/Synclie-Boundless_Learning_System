/** 擬似メンバーの名前に「(AI)」を付ける。先輩型・集約型の名前は、最初から末尾が「(AI)」なので重ねない。 */
export function withAiLabel(name: string): string {
  return /\(AI\)$/.test(name) ? name : `${name}(AI)`;
}
