import { describe, expect, it } from 'vitest';
import { parseReleaseNotes } from './releaseNotes';

describe('parseReleaseNotes', () => {
  it('拆分 bullets 与普通段落', () => {
    const body = '## 本次更新\n\n- feat: 新增设置页\n- fix: 修复开关滑块\n\n---\n\n下载 .dmg 安装';
    const notes = parseReleaseNotes(body);
    expect(notes.bullets).toEqual(['feat: 新增设置页', 'fix: 修复开关滑块']);
    expect(notes.paragraphs).toEqual(['本次更新', '下载 .dmg 安装']);
  });

  it('标题行剥掉 # 标记', () => {
    expect(parseReleaseNotes('# 标题').paragraphs).toEqual(['标题']);
  });

  it('空输入返回空结构', () => {
    expect(parseReleaseNotes('')).toEqual({ bullets: [], paragraphs: [] });
  });

  it('空行与分隔线被忽略', () => {
    expect(parseReleaseNotes('\n---\n\n- a\n').bullets).toEqual(['a']);
    expect(parseReleaseNotes('\n---\n\n- a\n').paragraphs).toEqual([]);
  });

  it('支持 * 列表标记', () => {
    expect(parseReleaseNotes('* one\n* two').bullets).toEqual(['one', 'two']);
  });
});
