import { LanguageSwitch } from "../ui/LanguageSwitch.tsx";
import type { AppConfig } from "@chat0110/chat-protocol";
import { s } from "../strings.ts";
import { ActionKeyLink, Body, Grille, Lamp, Mark, Screen } from "../ui/kit.tsx";

/** Вход: один корпус-прибор, одна оранжевая клавиша. */
export function Login({
  config,
  notice,
}: {
  config: AppConfig | null;
  notice?: { title: string; text: string } | undefined;
}) {
  return (
    <main className="box-border flex min-h-dvh flex-col items-center justify-center gap-[30px] bg-ground px-4 py-16 text-ink">
      <Body
        as="div"
        className="box-border flex w-full max-w-[420px] flex-col gap-6 rounded-entry! px-[30px] pt-[30px] pb-11 plinth-10!"
      >
        <div className="flex items-start justify-between gap-4">
          <Mark cell={5} />
          <span className="flex items-center gap-2 text-cap text-ink-2">
            <Lamp state="live" />
            {s.markSub}
          </span>
        </div>
        <LanguageSwitch />
        <a href="/connect" className="text-cap text-ink-2">{s.locale === "en" ? "Connect your AI" : "Подключить свой ИИ"}</a>
        <Grille width="100%" height={26} />
        <div className="flex flex-col gap-2.5">
          <h1 className="m-0 text-[24px] leading-[1.2] font-semibold tracking-[-0.02em]">{s.login.title}</h1>
          <p className="m-0 text-copy text-ink-2">{s.login.lead}</p>
        </div>
        {notice ? (
          <div role="alert" className="flex gap-3 rounded-screen bezel bg-plate px-4 py-3.5">
            <Lamp state="act" className="mt-[5px]" />
            <div className="flex flex-col gap-1">
              <b className="text-copy font-semibold">{notice.title}</b>
              <p className="m-0 text-cap leading-[1.45] text-ink-2">{notice.text}</p>
            </div>
          </div>
        ) : null}
        <ActionKeyLink href="/auth/login" className="min-h-12 px-[22px] text-copy">
          {s.login.signIn}
        </ActionKeyLink>
        <Screen as="div" className="px-4 py-3.5">
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-cap leading-[1.45] text-ink-2">
            {s.login.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Screen>
      </Body>
      {config?.install_url ? (
        <a href={config.install_url} className="text-cap text-ink-2 hover:text-action-ink">
          {s.login.install}
        </a>
      ) : null}
    </main>
  );
}
