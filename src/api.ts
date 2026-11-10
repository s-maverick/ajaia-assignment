import type { DocumentDetail, OwnedDocSummary, Role, Share, SharedDocSummary, User } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'Network error. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data);
  return data as T;
}

export const api = {
  demoUsers: () => request<{ users: User[] }>('GET', '/api/auth/users'),
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  login: (email: string) => request<{ user: User }>('POST', '/api/auth/login', { email }),
  logout: () => request<void>('POST', '/api/auth/logout'),

  listDocuments: () => request<{ owned: OwnedDocSummary[]; shared: SharedDocSummary[] }>('GET', '/api/documents'),
  createDocument: (title?: string) => request<{ document: DocumentDetail }>('POST', '/api/documents', { title }),
  importDocument: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<{ document: DocumentDetail }>('POST', '/api/documents/import', form);
  },
  getDocument: (id: string) =>
    request<{ document: DocumentDetail; role: Role; shares: Share[] }>('GET', `/api/documents/${id}`),
  renameDocument: (id: string, title: string) =>
    request<{ document: DocumentDetail }>('PATCH', `/api/documents/${id}`, { title }),
  saveContent: (id: string, contentHtml: string, baseVersion: number) =>
    request<{ document: DocumentDetail }>('PATCH', `/api/documents/${id}`, { contentHtml, baseVersion }),
  deleteDocument: (id: string) => request<void>('DELETE', `/api/documents/${id}`),

  share: (id: string, email: string, role: Share['role']) =>
    request<{ shares: Share[] }>('PUT', `/api/documents/${id}/shares`, { email, role }),
  unshare: (id: string, userId: string) => request<{ shares: Share[] }>('DELETE', `/api/documents/${id}/shares/${userId}`),
};

export const UPLOAD_ACCEPT = '.txt,.md,.markdown,.docx';
export const UPLOAD_HINT = 'Supported: .txt, .md, .docx (max 5 MB)';
