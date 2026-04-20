import type { Meta, StoryObj } from '@storybook/react-vite';

import './app-theme-board.css';

type ColorToken = {
  name: string;
  value: string;
  usage: string;
  swatchClass: string;
};

type PromptSpec = {
  title: string;
  description: string;
  prompt: string;
};

const homeTokens: ColorToken[] = [
  {
    name: 'Home Base',
    value: '#17181b',
    usage: 'Root shell background',
    swatchClass: 'swatch-home-base',
  },
  {
    name: 'Home Ambient Gradient',
    value:
      'radial(rgba(82,162,255,0.18), rgba(94,124,255,0.16), rgba(149,106,255,0.16))',
    usage: 'Atmospheric depth on landing page',
    swatchClass: 'swatch-home-ambient',
  },
  {
    name: 'Rail Surface',
    value: '#0e0f11',
    usage: 'Icon-only left rail',
    swatchClass: 'swatch-home-rail',
  },
  {
    name: 'Library Panel',
    value: '#111214',
    usage: 'Library and folder column',
    swatchClass: 'swatch-home-library',
  },
  {
    name: 'Main Surface',
    value: '#25272b',
    usage: 'Document board area',
    swatchClass: 'swatch-home-main',
  },
  {
    name: 'Hero Strip Gradient',
    value: 'linear(#3C86DF -> #3A98E0 -> #4A78D5 -> #7054C2)',
    usage: 'Primary visual brand band in home workspace',
    swatchClass: 'swatch-home-hero',
  },
  {
    name: 'Action Blue',
    value: '#2B9BFF',
    usage: 'Focus and active controls',
    swatchClass: 'swatch-home-action',
  },
  {
    name: 'Assist Cyan',
    value: '#5CC6F2',
    usage: 'Input ring and soft highlights',
    swatchClass: 'swatch-home-cyan',
  },
  {
    name: 'Warning Amber',
    value: '#FBBF24',
    usage: 'Open-file warning and repair hints',
    swatchClass: 'swatch-home-amber',
  },
];

const workspaceTokens: ColorToken[] = [
  {
    name: 'Workspace Base',
    value: '#0b0f16',
    usage: 'Main editor shell',
    swatchClass: 'swatch-workspace-base',
  },
  {
    name: 'Workspace Atmosphere',
    value: 'radial/linear dark blend with cool blue tint',
    usage: 'Global ambient backdrop behind editor panes',
    swatchClass: 'swatch-workspace-atmosphere',
  },
  {
    name: 'Top Bar Surface',
    value: '#171b23',
    usage: 'Main toolbar background',
    swatchClass: 'swatch-workspace-topbar',
  },
  {
    name: 'Canvas Surface',
    value: '#313741',
    usage: 'Document render area',
    swatchClass: 'swatch-workspace-canvas',
  },
  {
    name: 'Accent Blue',
    value: '#2B9BFF',
    usage: 'Primary action and active state',
    swatchClass: 'swatch-workspace-accent',
  },
  {
    name: 'Accent Blue Deep',
    value: '#2776FF',
    usage: 'Gradient pair for active tools',
    swatchClass: 'swatch-workspace-accent-deep',
  },
  {
    name: 'Support Cyan',
    value: '#22d3ee',
    usage: 'Download modal scope and action states',
    swatchClass: 'swatch-workspace-cyan',
  },
  {
    name: 'Support Emerald',
    value: '#10b981',
    usage: 'Content mode success-like actions',
    swatchClass: 'swatch-workspace-emerald',
  },
  {
    name: 'Warning Amber',
    value: '#f59e0b',
    usage: 'Warnings in export and OCR flow',
    swatchClass: 'swatch-workspace-amber',
  },
  {
    name: 'Danger Rose',
    value: '#f43f5e',
    usage: 'Error and destructive status blocks',
    swatchClass: 'swatch-workspace-rose',
  },
];

const stitchPrompts: PromptSpec[] = [
  {
    title: 'Master Prompt (System-Level)',
    description: 'Use this once to anchor style language before generating screens.',
    prompt: `Design a desktop-first Electron app UI for "PDF Translator".
Tone: precision tool + creative lab. Keep it dark, high-contrast, and information-dense but calm.
Visual style: layered glass panels, subtle atmospheric gradients, compact controls, no playful rounded toy look.
Layout rules:
- Left rail for global navigation
- Secondary sidebar for library/settings
- Main workspace for canvas and document preview
- Right utility panel for OCR/translation controls
- Sticky top toolbar for document actions
Typography:
- Primary: Mitr or Sarabun style Thai-friendly sans
- Tight vertical rhythm, small labels, strong hierarchy
Interaction:
- Active controls use blue gradient
- Validation uses cyan/emerald, warning uses amber, errors use rose
- Add clear hover, focus, and selected states
Do not redesign as a generic SaaS dashboard. Keep it as a production OCR translation workstation.`,
  },
  {
    title: 'Home Screen Prompt',
    description: 'Generate the landing/library page that opens before a file is loaded.',
    prompt: `Create the home screen for PDF Translator.
Intent: file library + quick-start launchpad.
Must include:
- Left icon rail
- Library sidebar with folders/tags/projects
- Main document board supporting grid and list views
- Right quick-start settings panel
- Prominent upload/dropzone area when library is empty
Color direction:
- Base background #17181b
- Side surfaces #0e0f11 and #111214
- Main board #25272b
- Hero strip gradient: #3C86DF -> #3A98E0 -> #4A78D5 -> #7054C2
- Primary interaction blue #2B9BFF with cyan support #5CC6F2
- Keep warning states in amber
Motion:
- soft fade/slide on panel reveal
- no heavy bounce animations
Output as a high-fidelity desktop layout with component callouts.`,
  },
  {
    title: 'Workspace Prompt',
    description: 'Generate the core working editor after a document is opened.',
    prompt: `Create the main working screen for PDF Translator after opening a file.
Intent: OCR + translation editing cockpit.
Must include:
- Top toolbar with document naming, mode switch, and tool states
- Left panel for page/document controls
- Center canvas area for rendered PDF/image page
- Right panel for OCR layer and translation controls
- Export/download modal style that matches shell
Color direction:
- Shell base #0b0f16
- Top bar #171b23
- Canvas area #313741
- Primary active gradient #2B9BFF -> #2776FF
- Supporting accents: cyan for scope actions, emerald for content actions, amber for warnings, rose for errors
Behavior:
- compact controls, keyboard-friendly, low visual noise
- strong selected states for active tools
- preserve a technical workstation vibe, not a marketing dashboard
Output desktop-first wireframe + polished visual variant.`,
  },
];

const TokenGrid = ({ title, tokens }: { title: string; tokens: ColorToken[] }) => (
  <section className="theme-token-section">
    <h3 className="theme-section-title">{title}</h3>
    <div className="theme-token-grid">
      {tokens.map((token) => (
        <article key={token.name} className="theme-token-card">
          <div className={`theme-token-swatch ${token.swatchClass}`} />
          <div className="theme-token-name">{token.name}</div>
          <div className="theme-token-value">{token.value}</div>
          <div className="theme-token-usage">{token.usage}</div>
        </article>
      ))}
    </div>
  </section>
);

const PromptStack = () => (
  <section className="theme-prompt-section">
    <h3 className="theme-section-title">Stitch Prompt Pack</h3>
    <div className="theme-prompt-stack">
      {stitchPrompts.map((item, index) => {
        const promptId = `stitch-prompt-${index}`;
        return (
        <article key={item.title} className="theme-prompt-card">
          <div className="theme-prompt-title">{item.title}</div>
          <p className="theme-prompt-description">{item.description}</p>
          <label className="theme-prompt-label" htmlFor={promptId}>
            Copy-ready prompt
          </label>
          <textarea
            id={promptId}
            readOnly
            value={item.prompt}
            className="theme-prompt-textarea"
            title={`${item.title} prompt`}
            aria-label={`${item.title} prompt`}
          />
        </article>
        )})}
    </div>
  </section>
);

const ThemeBoard = () => (
  <div className="theme-board-root">
    <header className="theme-board-header">
      <h2 className="theme-board-title">PDF Translator Design Pack</h2>
      <p className="theme-board-subtitle">
        Current app color map and copy-ready Stitch prompts for Home and Workspace remake.
      </p>
    </header>

    <TokenGrid title="Home Theme Tokens" tokens={homeTokens} />
    <TokenGrid title="Workspace Theme Tokens" tokens={workspaceTokens} />
    <PromptStack />
  </div>
);

const meta = {
  title: 'Design/App Theme Board',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const ThemeAndPrompts: Story = {
  render: () => <ThemeBoard />,
};
