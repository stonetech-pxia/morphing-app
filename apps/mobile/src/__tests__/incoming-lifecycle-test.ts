import { releaseShare, useIncoming } from '../share/incoming';
import { FakeFiles, TINY_JPEG } from '../test-utils/fake-files';

it('picker batches delete only the picker cache copies, never share copies or originals', async () => {
  const files = new FakeFiles();
  const photo = files.offer('copy.jpg', TINY_JPEG, 'image/jpeg');
  // Android 相册直接给的 content:// 地址：不是副本，不能删。
  const original = {
    uri: 'content://media/42',
    name: 'original.jpg',
    size: 3,
    mimeType: 'image/jpeg',
  };
  files.disk.set(original.uri, TINY_JPEG);
  const remove = jest.spyOn(files, 'removeShared');
  useIncoming.getState().receive([photo, original], [], 'picker');
  const id = useIncoming.getState().share!.id;
  await releaseShare(files, id);
  await releaseShare(files, id); // 重复关闭也不能调用分享文件删除。
  expect(remove).not.toHaveBeenCalled();
  expect(files.disk.has(photo.uri)).toBe(false);
  expect(files.disk.has(original.uri)).toBe(true);
  expect(useIncoming.getState().share).toBeNull();
  const again = files.offer('again.jpg', TINY_JPEG, 'image/jpeg');
  useIncoming.getState().receive([again], [], 'picker');
  const old = useIncoming.getState().share!.id;
  const shared = files.offerShared('new.jpg', TINY_JPEG, 'image/jpeg');
  useIncoming.getState().receive([shared]);
  await releaseShare(files, old);
  expect(remove).not.toHaveBeenCalled();
  expect(useIncoming.getState().share!.files).toEqual([shared]);
  await releaseShare(files, useIncoming.getState().share!.id);
  expect(files.sharedFiles()).toEqual([]);
  expect(files.disk.has(original.uri)).toBe(true);
});

it('finishing an older share preserves the new picker batch and only removes share copies', async () => {
  const files = new FakeFiles();
  const shared = files.offerShared('old.jpg', TINY_JPEG, 'image/jpeg');
  useIncoming.getState().receive([shared]);
  const old = useIncoming.getState().share!.id;
  const photo = files.offer('picked.jpg', TINY_JPEG, 'image/jpeg');
  useIncoming.getState().receive([photo], [], 'picker');
  await releaseShare(files, old);
  expect(files.sharedFiles()).toEqual([]);
  expect(files.disk.has(photo.uri)).toBe(true);
  expect(useIncoming.getState().share!.source).toBe('picker');
  await releaseShare(files, useIncoming.getState().share!.id);
});
