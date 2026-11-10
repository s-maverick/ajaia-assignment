import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { convertUpload, titleFromFilename } from '../server/importers';
import { HttpError } from '../server/errors';

/** Builds a minimal but valid .docx in memory so the test has no binary fixtures. */
async function makeDocx(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('convertUpload', () => {
  it('converts plain text into escaped paragraphs', async () => {
    const { html, title } = await convertUpload('notes.txt', Buffer.from('Hello <world>\nsecond line\n\nNew paragraph'));
    expect(title).toBe('notes');
    expect(html).toBe('<p>Hello &lt;world&gt;<br />second line</p><p>New paragraph</p>');
  });

  it('converts markdown structure and drops unsafe/unsupported markup', async () => {
    const md = '## Title\n\n1. one\n2. two\n\n<script>alert(1)</script>\n\n![img](http://x/y.png)';
    const { html } = await convertUpload('x.md', Buffer.from(md));
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toMatch(/<ol>\s*<li>one<\/li>/);
    expect(html).not.toMatch(/script|<img/);
  });

  it('converts .docx bold, italic and underline runs', async () => {
    const docx = await makeDocx(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold</w:t></w:r><w:r><w:t xml:space="preserve"> and </w:t></w:r>' +
        '<w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>under</w:t></w:r></w:p>',
    );
    const { html } = await convertUpload('Report.docx', docx);
    expect(html).toBe('<p><strong>Bold</strong> and <em>italic</em><u>under</u></p>');
  });

  it('rejects corrupt .docx, empty and unsupported files', async () => {
    await expect(convertUpload('a.docx', Buffer.from('not a zip'))).rejects.toMatchObject({ status: 422 });
    await expect(convertUpload('a.txt', Buffer.alloc(0))).rejects.toMatchObject({ status: 400 });
    await expect(convertUpload('a.txt', Buffer.from('\n\n   \n'))).rejects.toBeInstanceOf(HttpError);
    await expect(convertUpload('a.exe', Buffer.from('MZ'))).rejects.toMatchObject({ status: 415 });
  });
});

describe('titleFromFilename', () => {
  it('derives a readable title', () => {
    expect(titleFromFilename('q3_planning-notes.docx')).toBe('q3 planning notes');
    expect(titleFromFilename('.md')).toBe('Imported document');
  });
});
