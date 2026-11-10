export type Role = 'owner' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface OwnedDocSummary {
  id: string;
  title: string;
  updatedAt: string;
  shareCount: number;
  role: 'owner';
}

export interface SharedDocSummary {
  id: string;
  title: string;
  updatedAt: string;
  role: Exclude<Role, 'owner'>;
  owner: { name: string; email: string };
}

export interface DocumentDetail {
  id: string;
  title: string;
  contentHtml: string;
  version: number;
  owner: User;
  lastEditedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Share {
  userId: string;
  name: string;
  email: string;
  role: Exclude<Role, 'owner'>;
}
