import { THINKING_DEPTHS, REPLY_TEMPOS } from "@/lib/persona-traits";
import { getT } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/translate";

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

export async function PersonaForm({
  action,
  submitLabel,
  defaultValues,
}: {
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  defaultValues?: Partial<PersonaFormValues>;
}) {
  const v = defaultValues ?? {};
  const { t } = await getT();

  return (
    <form action={action} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">
          {t("personaForm.profile")}
        </legend>
        <label htmlFor="persona-name" className="sr-only">
          {t("personaForm.name")}
        </label>
        <input
          id="persona-name"
          name="name"
          placeholder={t("personaForm.namePlaceholder")}
          required
          defaultValue={v.name}
          className={inputClassName}
        />
        <label htmlFor="persona-role" className="sr-only">
          {t("personaForm.role")}
        </label>
        <input
          id="persona-role"
          name="role"
          placeholder={t("personaForm.rolePlaceholder")}
          defaultValue={v.role}
          className={inputClassName}
        />
        <label htmlFor="persona-developmental-stage" className="sr-only">
          {t("personaForm.stage")}
        </label>
        <input
          id="persona-developmental-stage"
          name="developmentalStage"
          placeholder={t("personaForm.stagePlaceholder")}
          defaultValue={v.developmentalStage}
          className={inputClassName}
        />
        <label htmlFor="persona-existing-knowledge" className="sr-only">
          {t("personaForm.knowledge")}
        </label>
        <textarea
          id="persona-existing-knowledge"
          name="existingKnowledge"
          placeholder={t("personaForm.knowledgePlaceholder")}
          rows={2}
          defaultValue={v.existingKnowledge}
          className={inputClassName}
        />
        <label htmlFor="persona-tone" className="sr-only">
          {t("personaForm.tone")}
        </label>
        <input
          id="persona-tone"
          name="tone"
          placeholder={t("personaForm.tonePlaceholder")}
          defaultValue={v.tone}
          className={inputClassName}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">
          {t("personaForm.stanceGoal")}
        </legend>
        <label htmlFor="persona-stance-position" className="sr-only">
          {t("personaForm.position")}
        </label>
        <textarea
          id="persona-stance-position"
          name="stancePosition"
          placeholder={t("personaForm.positionPlaceholder")}
          rows={2}
          defaultValue={v.stancePosition}
          className={inputClassName}
        />
        <label htmlFor="persona-stance-goal" className="sr-only">
          {t("personaForm.goal")}
        </label>
        <input
          id="persona-stance-goal"
          name="stanceGoal"
          placeholder={t("personaForm.goalPlaceholder")}
          defaultValue={v.stanceGoal}
          className={inputClassName}
        />
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-ink">
          {t("personaForm.rules")}
        </legend>
        <p className="text-xs text-ink-muted">
          {t("personaForm.rulesNote")}
        </p>
        <label htmlFor="persona-speaking-frequency" className="sr-only">
          {t("personaForm.freq")}
        </label>
        <select
          id="persona-speaking-frequency"
          name="speakingFrequency"
          defaultValue={v.speakingFrequency ?? "普通"}
          className={inputClassName}
        >
          <option value="控えめ">{t("personaForm.freqQuiet")}</option>
          <option value="普通">{t("personaForm.freqNormal")}</option>
          <option value="積極的">{t("personaForm.freqActive")}</option>
        </select>
        <label htmlFor="persona-teaching-degree" className="sr-only">
          {t("personaForm.teach")}
        </label>
        <select
          id="persona-teaching-degree"
          name="teachingDegree"
          defaultValue={v.teachingDegree ?? "問い返す"}
          className={inputClassName}
        >
          <option value="問い返すのみ">{t("personaForm.teachAsk")}</option>
          <option value="ヒントを出す">{t("personaForm.teachHint")}</option>
          <option value="直接説明する">{t("personaForm.teachDirect")}</option>
        </select>
        <label htmlFor="persona-thinking-depth" className="sr-only">
          {t("personaForm.depth")}
        </label>
        <select
          id="persona-thinking-depth"
          name="thinkingDepth"
          defaultValue={v.thinkingDepth ?? "標準"}
          className={inputClassName}
        >
          {THINKING_DEPTHS.map((d, i) => (
            <option key={d} value={d}>
              {t(`personaForm.depth${i}` as DictKey)}
            </option>
          ))}
        </select>
        <label htmlFor="persona-reply-tempo" className="sr-only">
          {t("personaForm.tempo")}
        </label>
        <select
          id="persona-reply-tempo"
          name="replyTempo"
          defaultValue={v.replyTempo ?? "ふつう"}
          className={inputClassName}
        >
          {REPLY_TEMPOS.map((tempo, i) => (
            <option key={tempo} value={tempo}>
              {t(`personaForm.tempo${i}` as DictKey)}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-muted">
          {t("personaForm.tempoNote")}
        </p>
        <label htmlFor="persona-intervention-condition" className="sr-only">
          {t("personaForm.intervene")}
        </label>
        <textarea
          id="persona-intervention-condition"
          name="interventionCondition"
          placeholder={t("personaForm.intervenePlaceholder")}
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
