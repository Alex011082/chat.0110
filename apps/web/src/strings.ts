// Все строки, которые видит человек, — только здесь. Английский и иврит
// встанут рядом отдельными модулями той же формы; компоненты текста не пишут.

export type Forms = readonly [one: string, few: string, many: string];

export const forms = {
  messages: ["сообщение", "сообщения", "сообщений"],
  participants: ["участник", "участника", "участников"],
  comments: ["комментарий", "комментария", "комментариев"],
  reviews: ["ревью", "ревью", "ревью"],
  files: ["файл", "файла", "файлов"],
} as const satisfies Record<string, Forms>;

export const s = {
  locale: "ru",
  appTitle: "chat.0110",
  mark: "0110",
  markSub: "chat",
  loading: "Загрузка…",
  retry: "Повторить",
  close: "Закрыть",
  cancel: "Отмена",
  copied: "Скопировано",

  time: {
    justNow: "только что",
    minAgo: (n: number) => `${n} мин назад`,
    hoursAgo: (n: number) => `${n} ч назад`,
    min: (n: number) => `${n} мин`,
    hours: (n: number) => `${n} ч`,
    yesterday: "вчера",
    today: "Сегодня",
    yesterdayDay: "Вчера",
  },

  login: {
    title: "Чат людей и ИИ, где каждый разговор — ветка в Git",
    lead: "Claude, Codex и ты пишете в один PR. История остаётся в твоём репозитории.",
    signIn: "Войти через GitHub",
    points: [
      "Доступ только к репозиториям, где ты установил приложение.",
      "Твои сообщения — коммиты от твоего имени, их видно в GitHub.",
      "Сервис не хранит переписку: источник истины — GitHub.",
    ],
    install: "Установить приложение на репозиторий",
    forbiddenTitle: "Нет доступа",
    forbidden:
      "Вход для этого аккаунта GitHub пока закрыт: идёт закрытая бета. Напиши владельцу chat.0110, чтобы тебя добавили, или войди другим аккаунтом.",
    serverDown: "Сервер не отвечает. Обнови страницу через минуту.",
  },

  rail: {
    label: "Разделы",
    chats: "Чаты",
    newChat: "Новый",
    tree: "Дерево",
    soon: "Скоро",
    logout: "Выйти",
  },

  list: {
    label: "Список чатов",
    heading: "Чаты",
    repo: "Репозиторий",
    search: "Поиск",
    searchLabel: "Поиск по чатам",
    archive: "Архив",
    rowMeta: (n: number, when: string) => `PR #${n} · ${when}`,
    closed: "закрыт",
    nothingFound: "Ничего не найдено",
    loadError: "Не удалось загрузить чаты.",
    noRepos: {
      title: "Нет подключённых репозиториев",
      text: "Чаты живут в твоих репозиториях. Установи приложение chat.0110 на репозиторий — и он появится здесь.",
      action: "Установить приложение",
    },
    noChats: {
      title: "Здесь пока нет чатов",
      text: "Новый чат — это ветка chat/… и draft PR в этом репозитории. Claude и Codex отвечают в ту же ветку.",
    },
    repoReadOnly: "только чтение",
  },

  empty: {
    pick: "Выбери чат слева",
    pickText: "Или создай новый — появятся ветка, draft PR и правила для агентов.",
    create: "Новый чат",
    notFound: "Чат не найден",
    notFoundText: "Возможно, его PR закрыт или у тебя нет доступа к репозиторию.",
  },

  header: {
    online: (when: string) => `на связи · синхронизировано ${when}`,
    offline: (when: string) => `нет связи · синхронизировано ${when}`,
    connecting: "подключение…",
    openInGitHub: "Открыть в GitHub",
    branch: "Ветка",
    pullRequest: "Pull request",
    messages: "Сообщений",
    prValue: (n: number, draft: boolean, closed: boolean) =>
      `#${n}${draft ? " · draft" : ""}${closed ? " · закрыт" : ""}`,
    infoKnob: "О чате и ссылка для агента",
    back: "Список чатов",
    phoneStatus: (n: number, status: string) => `PR #${n} · ${status}`,
    phoneOnline: "на связи",
    phoneOffline: "нет связи",
  },

  timeline: {
    label: "Лента сообщений",
    agent: "агент",
    pushedBy: (actor: string) => `запушил ${actor}`,
    postedBy: (actor: string) => `написал ${actor}`,
    file: (sha7: string) => (sha7 ? `файл ${sha7}` : "файл"),
    comment: "комментарий PR",
    fromPr: (n: number) => `PR #${n}`,
    notMerged: "не влито",
    published: "опубликовано",
    sending: "отправка — коммит в ветку…",
    failed: "Ошибка",
    retrySend: "Ошибка — повторить",
    reply: "Ответить",
    inGitHub: "В GitHub",
    link: "Ссылка",
    replyTo: (name: string, excerpt: string | null) =>
      excerpt ? `↳ ответ ${name}: «${excerpt}»` : `↳ ответ ${name}`,
    created: (actor: string, n: number, draft: boolean) =>
      `${actor} создал чат: ветка и ${draft ? "draft " : ""}PR #${n}`,
    pushed: (who: string, title: string, files: string) => `${who} запушил «${title}» · ${files}`,
    review: (who: string) => `Ревью · ${who}`,
    reviewLine: (path: string, line?: number) => (line ? `${path}, строка ${line}` : path),
    reviewState: {
      APPROVED: "одобрено",
      CHANGES_REQUESTED: "просит изменений",
      COMMENTED: "комментарий",
      DISMISSED: "отозвано",
    } as Record<string, string>,
    agentPrOpened: (who: string, n: number) => `${who} открыл PR #${n} в ветку чата`,
    agentPrPending: (count: string) => `не влито · ${count}`,
    agentPrMerged: (who: string, n: number) => `${who}: PR #${n} влит в чат`,
    agentPrClosed: (who: string, n: number) => `${who}: PR #${n} закрыт без слияния`,
    accept: "Принять в чат",
    accepting: "Принимаю…",
    openPr: (n: number) => `Открыть PR #${n}`,
    emptyChat: "В чате пока тихо. Напиши первое сообщение — оно станет файлом в ветке.",
    imageLink: (alt: string) => `[изображение${alt ? `: ${alt}` : ""}]`,
  },

  composer: {
    label: "Сообщение",
    placeholder: "Сообщение в чат…",
    send: "Отправить",
    hint: (branch: string) => `станет файлом-коммитом в ${branch}`,
    replyChip: (name: string, excerpt: string | null) => (excerpt ? `Ответ ${name} · «${excerpt}»` : `Ответ ${name}`),
    removeReply: "Убрать ответ",
    readOnly: "Писать сюда нельзя: у тебя нет права на запись в этот репозиторий. Читать чат можно.",
  },

  info: {
    label: "О чате",
    participants: "Участники",
    nobody: "Пока никто не писал.",
    owner: "владелец",
    agentWrote: (when: string) => `агент · писал ${when}`,
    humanWrote: (when: string) => `писал ${when}`,
    agentLink: "Ссылка для агента",
    agentLinkHelp: "Отправь Claude или Codex в их приложении — они прочитают чат и ответят в эту ветку.",
    agentPhrase: (url: string) =>
      `Прочитай чат ${url} по правилам chats/AGENTS.md и ответь новым файлом в ту же ветку.`,
    copy: "Скопировать",
    about: "О чате",
    createdBy: "Создал",
    inBranch: "В ветке",
    inPr: "В PR",
    stored: "Хранится",
    storedValue: "только в GitHub",
    soon: "Скоро: Fork из любого сообщения, дерево разговоров и решения — Этапы 2–5.",
    closeInfo: "Закрыть панель",
  },

  newChat: {
    title: "Новый чат",
    repo: "Репозиторий",
    repoHelp: "Только репо, где установлено приложение.",
    installOther: "Установить на другое",
    name: "Название",
    firstMessage: "Первое сообщение",
    optional: "— необязательно",
    branch: "Ветка",
    branchValue: "chat/<будет создана>",
    pr: "Pull request",
    prValue: "draft · метка chat0110",
    rules: "Правила для агентов",
    rulesValue: "chats/AGENTS.md",
    create: "Создать чат",
    creating: "Создаю…",
    noWritable: "Нет репозиториев с правом записи — создать чат негде.",
  },

  errors: {
    rateLimited: (sec: number) => `GitHub просит подождать ${sec} с`,
    network: "Нет связи с сервером. Проверь интернет и повтори.",
    generic: "Что-то пошло не так.",
    copyFailed: "Не удалось скопировать",
  },
} as const;
