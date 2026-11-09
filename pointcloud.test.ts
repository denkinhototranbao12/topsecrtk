import { describe, expect, it } from 'vitest';
import {
  LocalPotreeRequestManager,
  POTREE_BASE_URL,
  labelFromPath,
  parseDataIndex,
  parsePotreeMetadata,
  pickPotreeFiles,
  zeroPotreeOffset,
} from '../pointcloud';

function file(bytes: number[], name: string): File {
  return new File([new Uint8Array(bytes)], name);
}

describe('pickPotreeFiles', () => {
  it('nhận bộ 3 tệp chuẩn, không phân biệt hoa thường', () => {
    const r = pickPotreeFiles([file([1], 'METADATA.OCT'), file([2], 'Hierarchy.bin'), file([3], 'octree.bin')]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.set.metadata.name).toBe('METADATA.OCT');
      expect(r.set.octree.name).toBe('octree.bin');
    }
  });

  it('chấp nhận metadata.json của PotreeConverter 2.0', () => {
    const r = pickPotreeFiles([file([1], 'metadata.json'), file([2], 'hierarchy.bin'), file([3], 'octree.bin')]);
    expect(r.ok).toBe(true);
  });

  it('nêu rõ tệp còn thiếu thay vì báo lỗi chung chung', () => {
    const r = pickPotreeFiles([file([1], 'metadata.oct')]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.join(' ')).toContain('octree.bin');
  });
});

describe('parsePotreeMetadata', () => {
  const good = JSON.stringify({
    version: '2.1',
    name: 'Rainbow Bridge',
    points: 726371548,
    spacing: 13.037255468750004,
    attributes: [{ name: 'position' }, { name: 'rgb' }, { name: 'intensity' }],
  });

  it('đọc tên, số điểm, thuộc tính của Potree 2.x', () => {
    const m = parsePotreeMetadata(good);
    expect(m.name).toBe('Rainbow Bridge');
    expect(m.points).toBe(726371548);
    expect(m.attributes).toEqual(['position', 'rgb', 'intensity']);
  });

  it('từ chối tệp không phải JSON hoặc thiếu position', () => {
    expect(() => parsePotreeMetadata('<html>')).toThrow('không phải JSON');
    expect(() => parsePotreeMetadata(JSON.stringify({ attributes: [{ name: 'rgb' }] }))).toThrow('position');
    expect(() => parsePotreeMetadata(JSON.stringify({ name: 'x' }))).toThrow('thuộc tính');
  });
});

describe('chuẩn hoá offset Potree 2.x', () => {
  const withOffset = JSON.stringify({
    version: '2.1',
    name: 'XGrids LiDAR Data',
    offset: [-6794.251390565, -40649.454341604, -1.477658117],
    attributes: [{ name: 'position' }],
  });

  it('đưa offset về 0 để toạ độ điểm khớp hộp bao (potree-core cộng offset khi giải mã)', () => {
    const parsed = JSON.parse(zeroPotreeOffset(withOffset));
    expect(parsed.offset).toEqual([0, 0, 0]);
    expect(parsed.name).toBe('XGrids LiDAR Data');
  });

  it('không đổi gì khi offset đã bằng 0 hoặc tệp không phải JSON', () => {
    const zero = JSON.stringify({ version: '2.1', offset: [0, 0, 0] });
    expect(zeroPotreeOffset(zero)).toBe(zero);
    expect(zeroPotreeOffset('\u0000\u0001binary')).toBe('\u0000\u0001binary');
  });

  it('vẫn giữ offset gốc trong metadata để hiển thị cho người dùng', () => {
    const m = parsePotreeMetadata(withOffset);
    expect(m.offset).toEqual([-6794.251390565, -40649.454341604, -1.477658117]);
  });

  it('cầu nối tệp phục vụ metadata đã chuẩn hoá offset', async () => {
    const manager = new LocalPotreeRequestManager([
      new File([withOffset], 'metadata.oct'),
      file([], 'hierarchy.bin'),
    ]);
    const res = await manager.fetch(`${POTREE_BASE_URL}/metadata.json`);
    expect(JSON.parse(await res.text()).offset).toEqual([0, 0, 0]);
  });
});

describe('LocalPotreeRequestManager', () => {
  const bytes = Array.from({ length: 100 }, (_, i) => i);
  const manager = new LocalPotreeRequestManager([file(bytes, 'octree.bin'), file(bytes, 'metadata.oct')]);

  it('đọc đúng khoảng byte được yêu cầu (Range) như máy chủ thật', async () => {
    const res = await manager.fetch(`${POTREE_BASE_URL}/octree.bin`, {
      headers: { Range: 'bytes=10-19' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 10-19/100');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(10);
    expect(buf[0]).toBe(10);
    expect(buf[9]).toBe(19);
  });

  it('cắt đúng khi khoảng yêu cầu vượt quá cuối tệp', async () => {
    const res = await manager.fetch(`${POTREE_BASE_URL}/octree.bin`, {
      headers: { Range: 'bytes=95-9999' },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(5);
    expect(buf[4]).toBe(99);
  });

  it('phục vụ metadata.json dù tệp thật tên metadata.oct (Potree 2.1)', async () => {
    const res = await manager.fetch(`${POTREE_BASE_URL}/metadata.json`);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('không có Range thì trả cả tệp', async () => {
    const res = await manager.fetch(`${POTREE_BASE_URL}/metadata.oct`);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('thêm tiền tố local:// để potree-core thay được sang octree.bin, hierarchy.bin', async () => {
    const a = await manager.getUrl('metadata.json');
    expect(a).toBe(`${POTREE_BASE_URL}/metadata.json`);
    expect(a.replace('/metadata.json', '/octree.bin')).toBe(`${POTREE_BASE_URL}/octree.bin`);
    expect(await manager.getUrl(`${POTREE_BASE_URL}/hierarchy.bin`)).toBe(`${POTREE_BASE_URL}/hierarchy.bin`);
  });

  it('báo lỗi nêu tên tệp khi thư mục thiếu tệp', async () => {
    await expect(manager.fetch(`${POTREE_BASE_URL}/hierarchy.bin`)).rejects.toThrow('hierarchy.bin');
  });

  it('getUrl giữ nguyên đường dẫn để potree-core tự đổi sang octree.bin/hierarchy.bin', async () => {
    const url = `${POTREE_BASE_URL}/metadata.json`;
    expect(await manager.getUrl(url)).toBe(url);
    expect(url.replace('/metadata.json', '/octree.bin')).toBe(`${POTREE_BASE_URL}/octree.bin`);
  });
});

describe('dataIndex.json', () => {
  const sample = JSON.stringify({
    data: {
      cad: [],
      expandPoint: [],
      gaussianCloud: [],
      mesh: [],
      panomicData: [],
      pointCloud: [
        'C:/Users/Admin/Downloads/2. Rainbow Bridge (Demo Only No Public Use)_PointCloud_L3/Rainbow Bridge (Demo_Only_No_Public_Use)_potree/metadata.oct',
      ],
    },
  });

  it('đọc danh mục của công cụ trình chiếu và đánh dấu nhóm mở được', () => {
    const idx = parseDataIndex(sample);
    expect(idx.items).toHaveLength(1);
    expect(idx.items[0].group).toBe('pointCloud');
    expect(idx.items[0].supported).toBe(true);
    expect(idx.items[0].fileName).toBe('metadata.oct');
    expect(idx.items[0].label).toContain('Rainbow Bridge');
  });

  it('đánh dấu nhóm chưa hỗ trợ (mesh, CAD, toàn cảnh)', () => {
    const idx = parseDataIndex(
      JSON.stringify({ data: { mesh: ['C:/x/a.glb'], cad: ['C:/x/b.dwg'], panomicData: ['C:/x/c.jpg'] } }),
    );
    expect(idx.items.every((i) => !i.supported)).toBe(true);
  });

  it('từ chối tệp không đúng cấu trúc', () => {
    expect(() => parseDataIndex('{oops')).toThrow('JSON');
    expect(() => parseDataIndex('{"foo":1}')).toThrow('data');
    expect(() => parseDataIndex('{"data":{"mesh":[]}}')).toThrow('không có mục');
  });

  it('rút gọn nhãn từ đường dẫn Windows', () => {
    expect(labelFromPath('C:\\du-lieu\\Cau_Rainbow_potree\\metadata.oct')).toBe('Cau Rainbow');
  });
});
