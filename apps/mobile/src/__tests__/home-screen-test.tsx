import { render, screen } from '@testing-library/react-native';

import HomeScreen from '../app/index';

test('home screen shows the schema version from @morph/core', async () => {
  await render(<HomeScreen />);
  expect(screen.getByText('M0 骨架已运行 · schema v1')).toBeTruthy();
});
