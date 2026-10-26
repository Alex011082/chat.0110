// owner/name из git remote. Имя репозитория может содержать точку: chat.0110.
export function githubRepo(remote: string): { owner: string; name: string } | null {
  const match = remote.trim().match(/github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!match) return null;
  return { owner: match[1]!, name: match[2]! };
}
