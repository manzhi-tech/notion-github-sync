import { Octokit } from "@octokit/rest";

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.octokit.rest.users.getAuthenticated();
      return true;
    } catch {
      return false;
    }
  }

  async validateRepo(repo: string): Promise<boolean> {
    try {
      const [owner, name] = repo.split("/");
      await this.octokit.rest.repos.get({ owner, repo: name });
      return true;
    } catch {
      return false;
    }
  }

  async getIssue(repo: string, number: number) {
    const [owner, name] = repo.split("/");
    const { data } = await this.octokit.rest.issues.get({
      owner,
      repo: name,
      issue_number: number,
    });
    return data;
  }

  async getPullRequest(repo: string, number: number) {
    const [owner, name] = repo.split("/");
    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo: name,
      pull_number: number,
    });
    return data;
  }

  async updateIssue(
    repo: string,
    number: number,
    update: {
      title?: string;
      body?: string;
      state?: "open" | "closed";
      labels?: string[];
      assignees?: string[];
    },
  ) {
    const [owner, name] = repo.split("/");
    const { data } = await this.octokit.rest.issues.update({
      owner,
      repo: name,
      issue_number: number,
      ...update,
    });
    return data;
  }

  async createIssue(
    repo: string,
    params: {
      title: string;
      body?: string;
      labels?: string[];
      assignees?: string[];
    },
  ) {
    const [owner, name] = repo.split("/");
    const { data } = await this.octokit.rest.issues.create({
      owner,
      repo: name,
      ...params,
    });
    return data;
  }

  async getDefaultBranch(repo: string): Promise<string> {
    const [owner, name] = repo.split("/");
    const { data } = await this.octokit.rest.repos.get({
      owner,
      repo: name,
    });
    return data.default_branch;
  }

  async createOrUpdateFile(
    repo: string,
    path: string,
    content: ArrayBuffer,
    message: string,
  ): Promise<string> {
    const [owner, name] = repo.split("/");

    // Check if file already exists to get its SHA
    let sha: string | undefined;
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo: name,
        path,
      });
      if (!Array.isArray(data) && data.type === "file") {
        sha = data.sha;
      }
    } catch {
      // File doesn't exist, that's fine
    }

    const base64Content = arrayBufferToBase64(content);

    const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo: name,
      path,
      message,
      content: base64Content,
      sha,
    });

    // Return raw URL
    const defaultBranch = await this.getDefaultBranch(repo);
    return `https://raw.githubusercontent.com/${owner}/${name}/${defaultBranch}/${path}`;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
