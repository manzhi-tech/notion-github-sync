import { Client } from "@notionhq/client";
import type {
  PageObjectResponse,
  BlockObjectResponse,
  PartialBlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";

export type { PageObjectResponse, BlockObjectResponse };

/**
 * A block with recursively-fetched children attached.
 * Uses a loose type because BlockObjectResponse is a large discriminated union
 * that cannot be cleanly extended.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BlockWithChildren = Record<string, any> & {
  id: string;
  type: string;
  has_children: boolean;
  children?: BlockWithChildren[];
};

const REQUIRED_PROPERTIES = [
  "Name",
  "GitHub ID",
  "GitHub URL",
  "GitHub Type",
  "Repo",
  "Status",
];

export class NotionClient {
  private client: Client;
  private databaseId: string;

  constructor(token: string, databaseId: string) {
    this.client = new Client({ auth: token });
    this.databaseId = databaseId;
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.client.databases.retrieve({
        database_id: this.databaseId,
      });
      return true;
    } catch {
      return false;
    }
  }

  async validateDatabaseSchema(): Promise<{
    valid: boolean;
    missing: string[];
  }> {
    try {
      const db = await this.client.databases.retrieve({
        database_id: this.databaseId,
      });
      const properties = Object.keys(
        (db as { properties: Record<string, unknown> }).properties,
      );
      const missing = REQUIRED_PROPERTIES.filter(
        (name) => !properties.includes(name),
      );
      return { valid: missing.length === 0, missing };
    } catch {
      return { valid: false, missing: REQUIRED_PROPERTIES };
    }
  }

  async getPage(pageId: string): Promise<PageObjectResponse> {
    const page = await this.client.pages.retrieve({ page_id: pageId });
    return page as PageObjectResponse;
  }

  async getBlocks(blockId: string): Promise<BlockWithChildren[]> {
    const blocks: BlockWithChildren[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });

      for (const block of response.results) {
        if (!isFullBlock(block)) continue;

        const bwc = block as unknown as BlockWithChildren;
        blocks.push(bwc);

        // Recursively fetch children
        if (bwc.has_children) {
          bwc.children = await this.getBlocks(bwc.id);
        }
      }

      cursor = response.has_more ? response.next_cursor! : undefined;
    } while (cursor);

    return blocks;
  }

  async updatePage(
    pageId: string,
    properties: Record<string, unknown>,
  ): Promise<PageObjectResponse> {
    const page = await this.client.pages.update({
      page_id: pageId,
      properties: properties as Record<string, never>,
    });
    return page as PageObjectResponse;
  }

  async createPage(
    properties: Record<string, unknown>,
  ): Promise<PageObjectResponse> {
    const page = await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: properties as Record<string, never>,
    });
    return page as PageObjectResponse;
  }

  async queryDatabase(
    filter?: Record<string, unknown>,
  ): Promise<PageObjectResponse[]> {
    const pages: PageObjectResponse[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.databases.query({
        database_id: this.databaseId,
        filter: filter as never,
        start_cursor: cursor,
        page_size: 100,
      });

      for (const page of response.results) {
        pages.push(page as PageObjectResponse);
      }

      cursor = response.has_more ? response.next_cursor! : undefined;
    } while (cursor);

    return pages;
  }
}

function isFullBlock(
  block: BlockObjectResponse | PartialBlockObjectResponse,
): block is BlockObjectResponse {
  return "type" in block;
}
