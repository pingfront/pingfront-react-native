import fs from 'node:fs';
import path from 'node:path';

// The example app is what customers copy, so it must not carry layout habits that break when the window
// resizes or the safe area is lopsided, as on a foldable iPhone (iPhone Duo): its controls sit in a bar on
// one side, which side depends on the pose and the half of Split View, and the window changes size while
// the app runs. The example lives outside Jest's roots, so this reads its source.

const app = fs.readFileSync(
  path.join(__dirname, '..', '..', 'example', 'src', 'App.tsx'),
  'utf8'
);
const component = app.indexOf('export default function App');

describe('example layout', () => {
  it('has the App component', () => {
    expect(component).toBeGreaterThan(0);
  });

  it('never takes a snapshot of the window size', () => {
    // Dimensions.get() goes stale on the next resize; useWindowDimensions() re-renders.
    expect(app).not.toMatch(/Dimensions\.get\(/);
  });

  it('reads insets on render, not once at module scope', () => {
    const moduleScope = app.slice(0, component);
    expect(moduleScope).not.toMatch(/StatusBar\.currentHeight/);
    expect(moduleScope).not.toMatch(/useWindowDimensions|Dimensions\./);
  });

  it('insets its scroll views on every edge', () => {
    // "automatic" adjusts only the scrolling axis on iOS, so a vertical list runs under a bar at the side.
    const scrollViews = app.match(/<ScrollView[\s\S]*?>/g) ?? [];
    expect(scrollViews.length).toBeGreaterThan(0);
    for (const tag of scrollViews) {
      expect(tag).toMatch(/contentInsetAdjustmentBehavior="always"/);
    }
  });

  it('never subtracts one inset twice', () => {
    // Symmetric inset math (width - inset * 2) is wrong when the two sides differ.
    expect(app).not.toMatch(/\*\s*2\b/);
  });
});
