import test from 'node:test';
import assert from 'node:assert/strict';

import { axe } from 'jest-axe';
import { installDom } from './dom.mjs';

import DashboardConnectionStatus from '../../src/renderer/src/components/DashboardConnectionStatus.jsx';
import HoverText from '../../src/renderer/src/components/HoverText.jsx';
import TermRuleSummary from '../../src/renderer/src/components/TermRuleSummary.jsx';

installDom();

const t = (key) => key;

async function expectNoA11yViolations(element) {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const html = renderToStaticMarkup(
    <main data-testid="a11y-harness">{element}</main>
  );
  const results = await axe(html);
  assert.equal(
    results.violations.length,
    0,
    `Expected no a11y violations but got:\n${JSON.stringify(results.violations, null, 2)}`
  );
}

test('DashboardConnectionStatus renders without a11y violations', async () => {
  await expectNoA11yViolations(<DashboardConnectionStatus initialState={null} t={t} />);
});

test('HoverText renders with value and fallback without a11y violations', async () => {
  await expectNoA11yViolations(<HoverText value="  profile.name  " />);
  await expectNoA11yViolations(<HoverText value="" fallback="-" />);
});

test('TermRuleSummary renders supported and unsupported rules without a11y violations', async () => {
  await expectNoA11yViolations(
    <TermRuleSummary
      label="Term rule"
      t={t}
      rule={{ raw: ['case: preserve'], status: 'supported', caseMode: 'preserve', matching: 'exact' }}
    />
  );
  await expectNoA11yViolations(
    <TermRuleSummary
      label="Term rule"
      t={t}
      rule={{ raw: null, status: 'unsupported', unsupported: ['caseMode'] }}
    />
  );
});
