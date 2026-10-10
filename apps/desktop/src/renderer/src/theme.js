// The theme itself (brand seed, the contrast floor, system display preferences) comes
// from @langlink-tech/antd-kit. This file holds only what is specific to memoQ AI Hub.
export const BRAND = 'memoq';

// AntD's Layout header defaults to a dark navy. The shell is a plain surface on the page background.
const SURFACE = 'var(--ll-color-bg-container)';

export const appTheme = {
  // index.css reads AntD's CSS variables under this prefix (--memoq-color-*, --memoq-border-radius-*).
  cssVar: {
    prefix: 'memoq',
    key: 'memoq-ai-hub'
  },
  token: {
    // memoQ's status colours, corner radius and Windows-first font stack. They are product
    // identity that the kit's memoq preset does not carry yet; move them there when it does.
    colorSuccess: '#00a68b',
    colorWarning: '#d48806',
    colorError: '#cf294d',
    borderRadius: 4,
    fontFamily: "'Segoe UI', 'PingFang SC', sans-serif"
  },
  components: {
    Layout: {
      headerBg: SURFACE,
      headerHeight: 64,
      headerPadding: '0 24px',
      bodyBg: 'var(--ll-color-bg-page)',
      lightSiderBg: SURFACE
    }
  }
};
