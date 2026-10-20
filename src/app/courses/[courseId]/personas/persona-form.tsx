import { THINKING_DEPTHS, REPLY_TEMPOS } from "@/lib/persona-traits";

// F03: ペルソナ設定フォーム。作成・編集の両方で使う共通コンポーネント。
// 要件定義書5章「擬似メンバーの構造」の4要素のうち、知識源(授業RAG)は
// course_id経由で暗黙に決まるため、ここではプロフィール/立場と目標/行動ルールのみ入力する。

export interface PersonaFormValues {
  name: string;
  role: string;
  developmentalStage: string;
  existingKnowledge: string;
  tone: string;
  stancePosition: string;
  stanceGoal: string;
  speakingFrequency: string;
  teachingDegree: string;
  interventionCondition: string;
  thinkingDepth: string;
  replyTempo: string;
}

const inputClassName =
  "w-full rounded-md border border-line px-3 py-2 text-sm bg-surface-raised";

export function PersonaForm({
  action,
  submitLabel,
  defaultValues,
}: {
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  defaultValues?: Partial<PersonaFormValues>;
}) {
  const v = defaultValues ?? {};

  return (
    <form action={action} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">
          プロフィール
        </legend>
        <label htmlFor="persona-name" className="sr-only">
          名前
        </label>
        <input
          id="persona-name"
          name="name"
          placeholder="名前(例: ミライさん)"
          required
          defaultValue={v.name}
          className={inputClassName}
        />
        <label htmlFor="persona-role" className="sr-only">
          役割
        </label>
        <input
          id="persona-role"
          name="role"
          placeholder="役割(例: クラスメイト、先輩)"
          defaultValue={v.role}
          className={inputClassName}
        />
        <label htmlFor="persona-developmental-stage" className="sr-only">
          発達段階
        </label>
        <input
          id="persona-developmental-stage"
          name="developmentalStage"
          placeholder="発達段階(例: 小学5年生相当)"
          defaultValue={v.developmentalStage}
          className={inputClassName}
        />
        <label htmlFor="persona-existing-knowledge" className="sr-only">
          既有知識
        </label>
        <textarea
          id="persona-existing-knowledge"
          name="existingKnowledge"
          placeholder="既有知識(このペルソナが既に知っている前提)"
          rows={2}
          defaultValue={v.existingKnowledge}
          className={inputClassName}
        />
        <label htmlFor="persona-tone" className="sr-only">
          口調
        </label>
        <input
          id="persona-tone"
          name="tone"
          placeholder="口調(例: 友達言葉、丁寧語)"
          defaultValue={v.tone}
          className={inputClassName}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">
          立場と目標
        </legend>
        <label htmlFor="persona-stance-position" className="sr-only">
          立場
        </label>
        <textarea
          id="persona-stance-position"
          name="stancePosition"
          placeholder="立場(例: 現場の見取りを重んじる視点。対立する立場を代表させたい場合はここに書く)"
          rows={2}
          defaultValue={v.stancePosition}
          className={inputClassName}
        />
        <label htmlFor="persona-stance-goal" className="sr-only">
          目標
        </label>
        <input
          id="persona-stance-goal"
          name="stanceGoal"
          placeholder="目標(例: 学習者に具体例を求め続ける)"
          defaultValue={v.stanceGoal}
          className={inputClassName}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">
          行動ルール
        </legend>
        <p className="text-xs text-ink-muted">
          AI明示・資料限定・同調禁止・問い返しなどの共通ガードレールは全ペルソナに常に適用される
          (src/lib/ai/persona.ts の COMMON_GUARDRAILS)。ここではこのペルソナ固有の調整のみ設定する。
        </p>
        <label htmlFor="persona-speaking-frequency" className="sr-only">
          発言頻度
        </label>
        <select
          id="persona-speaking-frequency"
          name="speakingFrequency"
          defaultValue={v.speakingFrequency ?? "普通"}
          className={inputClassName}
        >
          <option value="控えめ">発言頻度: 控えめ</option>
          <option value="普通">発言頻度: 普通</option>
          <option value="積極的">発言頻度: 積極的</option>
        </select>
        <label htmlFor="persona-teaching-degree" className="sr-only">
          教える度合い
        </label>
        <select
          id="persona-teaching-degree"
          name="teachingDegree"
          defaultValue={v.teachingDegree ?? "問い返す"}
          className={inputClassName}
        >
          <option value="問い返すのみ">教える度合い: 問い返すのみ(答えを直接教えない)</option>
          <option value="ヒントを出す">教える度合い: ヒントを出す</option>
          <option value="直接説明する">教える度合い: 直接説明する</option>
        </select>
        <label htmlFor="persona-thinking-depth" className="sr-only">
          考え方の深さ
        </label>
        <select
          id="persona-thinking-depth"
          name="thinkingDepth"
          defaultValue={v.thinkingDepth ?? "標準"}
          className={inputClassName}
        >
          {THINKING_DEPTHS.map((d) => (
            <option key={d} value={d}>
              考え方の深さ: {d}
              {d === "直感的" ? "(印象や経験から、短く素早く)" : d === "じっくり論理的" ? "(前提・根拠・反例を分けて、筋道立てて)" : ""}
            </option>
          ))}
        </select>
        <label htmlFor="persona-reply-tempo" className="sr-only">
          返答のテンポ
        </label>
        <select
          id="persona-reply-tempo"
          name="replyTempo"
          defaultValue={v.replyTempo ?? "ふつう"}
          className={inputClassName}
        >
          {REPLY_TEMPOS.map((t) => (
            <option key={t} value={t}>
              返答のテンポ: {t}
              {t === "すばやい" ? "(すぐ答える)" : t === "ゆっくり" ? "(間をおいて、ゆっくり答える)" : ""}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-muted">
          「返答のテンポ」は、返答が画面に出るまでの間と、文字の出る速さの個性です(AIの実際の生成速度は変わりません)。
        </p>
        <label htmlFor="persona-intervention-condition" className="sr-only">
          介入の条件
        </label>
        <textarea
          id="persona-intervention-condition"
          name="interventionCondition"
          placeholder="介入の条件(例: 学習者が5分以上行き詰まったときのみ発言する)"
          rows={2}
          defaultValue={v.interventionCondition}
          className={inputClassName}
        />
      </fieldset>

      <button
        type="submit"
        className="rounded-md bg-accent-fill px-4 py-2 text-sm font-medium text-white hover:bg-accent-fill-hover"
      >
        {submitLabel}
      </button>
    </form>
  );
}
