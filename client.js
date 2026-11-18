// Pi 模式 Session view: profile-wide skills/MCP/compaction settings.
// It reads and writes the volatile pi-settings namespace through the Settings
// Remote, so browsing the view never creates command transcript rows.
window.__ModuleLoader__.load({
  id: '@skiyer/dsh-pi-context',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const styles = {
      root: {
        width: '100%',
        maxWidth: '900px',
        margin: '0 auto',
        alignSelf: 'stretch',
        padding: '28px 32px 48px',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        background: 'var(--dsw-alias-bg-subtle, transparent)',
        minHeight: '100%',
        boxSizing: 'border-box',
      },
      header: { margin: '0 2px 26px' },
      title: { margin: '0 0 5px', fontSize: '24px', fontWeight: 650, letterSpacing: '-0.02em' },
      hint: { margin: 0, color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: '13px', lineHeight: 1.55 },
      group: { width: '100%', marginBottom: '24px' },
      groupHeaderButton: { display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', width: '100%', margin: '0 0 9px', padding: '0 2px', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' },
      groupHeading: { minWidth: 0, flex: '1 1 auto' },
      groupTitle: { fontSize: '13px', fontWeight: 600, lineHeight: 1.35 },
      groupHint: { marginTop: '2px', color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: '12px', lineHeight: 1.45 },
      card: {
        background: 'var(--dsw-alias-bg-base, #fff)',
        border: '1px solid var(--dsw-alias-border-subtle, rgba(15, 23, 42, 0.09))',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
      },
      row: { display: 'flex', alignItems: 'center', gap: '13px', minHeight: '72px', padding: '14px 18px', boxSizing: 'border-box' },
      rowBorder: { borderTop: '1px solid var(--dsw-alias-border-subtle, rgba(15, 23, 42, 0.08))' },
      icon: {
        flex: '0 0 38px',
        width: '38px',
        height: '38px',
        borderRadius: '11px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        userSelect: 'none',
      },
      rowText: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 auto' },
      name: { fontSize: '14px', fontWeight: 600, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      description: { color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: '12px', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' },
      empty: { color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: '12px', padding: '2px 18px 16px' },
      chevron: { flex: '0 0 14px', display: 'inline-block', width: '14px', textAlign: 'center', fontSize: '12px', opacity: 0.7, transition: 'transform 140ms ease' },
      closedButton: { display: 'flex', alignItems: 'center', gap: '7px', width: '100%', margin: '18px 0 9px', padding: '0 2px', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: '12px', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' },
      switch: {
        flex: '0 0 auto',
        width: '42px',
        height: '24px',
        padding: '2px',
        border: 0,
        borderRadius: '999px',
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        cursor: 'pointer',
        transition: 'background 140ms ease, opacity 140ms ease',
      },
      knob: {
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-bg-base, #fff)',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.22)',
        transition: 'transform 140ms ease',
      },
      fieldRow: { display: 'flex', alignItems: 'center', gap: '13px', minHeight: '68px', padding: '13px 18px', boxSizing: 'border-box' },
      segments: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '2px',
        padding: '3px',
        borderRadius: '11px',
        background: 'var(--dsw-alias-bg-subtle, #f1f2f4)',
        flex: '0 1 auto',
      },
      segment: {
        minWidth: '42px',
        padding: '7px 10px',
        borderRadius: '9px',
        border: 0,
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #6b7280)',
        fontSize: '13px',
        fontWeight: 450,
        fontVariantNumeric: 'tabular-nums',
        cursor: 'pointer',
      },
      segmentActive: {
        background: 'var(--dsw-alias-bg-base, #fff)',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        fontWeight: 600,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.14)',
      },
      fieldInput: {
        width: '112px',
        padding: '7px 9px',
        border: '1px solid var(--dsw-alias-border-subtle, rgba(15, 23, 42, 0.12))',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-base, #fff)',
        color: 'inherit',
        fontSize: '13px',
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        boxSizing: 'border-box',
      },
      footer: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '24px' },
      button: {
        padding: '9px 19px',
        borderRadius: '9px',
        border: 0,
        background: 'var(--dsw-alias-label-primary, #1f2328)',
        color: 'var(--dsw-alias-bg-base, #fff)',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
      },
      status: { color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: '12px' },
      error: { color: 'var(--dsw-alias-label-danger, #b42318)', fontSize: '13px', marginTop: '10px', whiteSpace: 'pre-wrap' },
      loading: { padding: '28px 32px', color: 'var(--dsw-alias-label-secondary, #6b7280)', fontSize: '13px' },
    };

    function DocumentIcon() {
      return h('svg', {
        width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
        h('path', { d: 'M14 2v6h6' }),
        h('path', { d: 'M8 13h8M8 17h6' }));
    }

    function ToolIcon() {
      return h('svg', {
        width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z' }));
    }

    function IconTile({ kind, label }) {
      return h('span', {
        className: 'pi-config-icon',
        style: {
          ...styles.icon,
          color: 'var(--dsw-alias-label-secondary, #4b5563)',
          background: 'var(--dsw-alias-bg-subtle, #f3f4f6)',
          border: '1px solid var(--dsw-alias-border-subtle, rgba(15, 23, 42, 0.08))',
        },
      }, kind === 'skill' ? h(DocumentIcon) : kind === 'mcp' ? h(ToolIcon) : (label ?? ''));
    }

    function Toggle({ checked, disabled, onChange, label }) {
      return h('button', {
        type: 'button',
        className: 'pi-config-toggle',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        onClick: onChange,
        style: {
          ...styles.switch,
          background: checked
            ? 'var(--dsw-alias-label-primary, #1f2328)'
            : 'var(--dsw-alias-border-subtle, #e5e7eb)',
          opacity: disabled ? 0.45 : 1,
        },
      }, h('span', {
        style: {
          ...styles.knob,
          transform: checked ? 'translateX(18px)' : 'none',
        },
      }));
    }

    const THRESHOLD_OPTIONS = [0.8, 0.9, 0.95, 0.99];

    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style');
        style.dataset.plugin = '@skiyer/dsh-pi-context';
        style.textContent = `
          body:has([data-pi-config-view]) [data-width-handle] { display: none !important; }
          .pi-config-group-head { transition: color 120ms ease, background-color 120ms ease; border-radius: 7px; }
          .pi-config-group-head:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.035)); }
          .pi-config-group-head:hover .pi-config-chevron { opacity: 1; }
          .pi-config-closed { transition: color 120ms ease; }
          .pi-config-closed:hover { color: var(--dsw-alias-label-primary, #1f2328); }
          .pi-config-row { transition: background-color 120ms ease; }
          .pi-config-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(15, 23, 42, 0.035)); }
          .pi-config-icon { transition: transform 160ms ease, box-shadow 160ms ease; }
          .pi-config-row:hover .pi-config-icon { transform: translateY(-1px); box-shadow: 0 3px 8px rgba(15, 23, 42, 0.08); }
          .pi-config-toggle { transition: filter 120ms ease, transform 120ms ease, opacity 120ms ease; }
          .pi-config-toggle:not(:disabled):hover { filter: brightness(0.92); }
          .pi-config-toggle:not(:disabled):active { transform: scale(0.94); }
          .pi-config-toggle:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #247bbf); outline-offset: 2px; }
          .pi-config-segment { transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease; }
          .pi-config-segment:not(.pi-config-segment-active):hover { background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 65%, transparent); color: var(--dsw-alias-label-primary, #1f2328); }
          .pi-config-segment:active { transform: scale(0.96); }
          .pi-config-segment:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #247bbf); outline-offset: 1px; }
          .pi-config-input { transition: border-color 120ms ease, box-shadow 120ms ease; }
          .pi-config-input:hover { border-color: var(--dsw-alias-border-l3, rgba(15, 23, 42, 0.24)); }
          .pi-config-input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary, #247bbf); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary, #247bbf) 16%, transparent); }
          .pi-config-save { transition: filter 120ms ease, transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease; }
          .pi-config-save:not(:disabled):hover { filter: brightness(1.08); transform: translateY(-1px); box-shadow: 0 5px 14px rgba(15, 23, 42, 0.18); }
          .pi-config-save:not(:disabled):active { transform: translateY(0); }
          .pi-config-save:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #247bbf); outline-offset: 2px; }
        `;
        document.head.appendChild(style);
        return () => style.remove();
      });

      function PiConfigView(props) {
        const { sessionId } = props;
        const [config, setConfig] = React.useState(undefined);
        const [savedConfig, setSavedConfig] = React.useState(undefined);
        const [revision, setRevision] = React.useState(undefined);
        const [availableSkills, setAvailableSkills] = React.useState([]);
        const [skillError, setSkillError] = React.useState('');
        const [error, setError] = React.useState('');
        const [status, setStatus] = React.useState('');
        const [saving, setSaving] = React.useState(false);
        const [collapsed, setCollapsed] = React.useState({ skills: false, mcp: false, compaction: false, closedSkills: false, closedMcp: false });
        const toggleGroup = (key) => setCollapsed((current) => ({ ...current, [key]: !current[key] }));

        const fromNamespace = (namespace) => ({
          disabledSkills: Array.isArray(namespace.value.disabledSkills) ? namespace.value.disabledSkills : [],
          disabledMcpServers: Array.isArray(namespace.value.disabledMcpServers) ? namespace.value.disabledMcpServers : [],
          availableMcpServers: (Array.isArray(namespace.value.availableMcpServers) ? namespace.value.availableMcpServers : [])
            .map((entry) => typeof entry === 'string'
              ? { name: entry, description: '' }
              : { name: String(entry?.name ?? ''), description: typeof entry?.description === 'string' ? entry.description : '' })
            .filter((entry) => entry.name.length > 0),
          compaction: {
            retainTokens: namespace.value.retainTokens,
            headroomTokens: namespace.value.headroomTokens,
            thresholdRatio: namespace.value.thresholdRatio,
            maxTokens: namespace.value.maxTokens,
          },
        });

        React.useEffect(() => {
          let active = true;
          const abort = new AbortController();
          setError('');
          setSkillError('');
          (async () => {
            try {
              const result = await ctx.remote.settings.describe();
              if (result.ok !== true) throw new Error(result.error?.message ?? 'Pi 配置不可用');
              const namespace = result.value.namespaces.find((entry) => entry.ns === 'pi-settings');
              if (namespace === undefined) throw new Error('pi-settings 设置命名空间未注册');
              if (active) {
                const next = fromNamespace(namespace);
                setConfig(next);
                setSavedConfig(next);
                setRevision(namespace.revision);
              }
            } catch (reason) {
              if (active) setError(reason instanceof Error ? reason.message : String(reason));
            }
            try {
              const result = await ctx.remote.skills.list({ sessionId }, abort.signal);
              if (result.ok !== true) throw new Error(result.error?.message ?? 'skill 列表不可用');
              if (active) {
                const visible = Array.isArray(result.value.skills) ? result.value.skills : [];
                setAvailableSkills(visible.filter((skill) => skill.modelInvocable === true && typeof skill.path === 'string'));
              }
            } catch (reason) {
              if (active) setSkillError(reason instanceof Error ? reason.message : String(reason));
            }
          })();
          return () => { active = false; abort.abort(); };
        }, [sessionId]);

        if (error !== '') {
          return h('div', { className: 'pi-config-view', style: styles.root, 'data-pi-config-view': 'true' },
            h('div', { style: styles.header },
              h('h2', { style: styles.title }, 'Pi 配置'),
              h('p', { style: styles.hint }, '作用于整个 Pi 模式（所有 Pi 会话）；下一次请求/压缩生效。')),
            h('div', { style: styles.error }, error));
        }
        if (config === undefined) {
          return h('div', { className: 'pi-config-view', style: styles.root, 'data-pi-config-view': 'true' },
            h('h2', { style: styles.title }, 'Pi 配置'),
            h('div', { style: styles.loading }, '加载中…'));
        }

        const updateCompaction = (patch) => setConfig((current) => ({
          ...current,
          compaction: { ...current.compaction, ...patch },
        }));
        const toggleName = (field, name, checked) => setConfig((current) => {
          const currentNames = Array.isArray(current[field]) ? current[field] : [];
          const names = checked
            ? currentNames.filter((entry) => entry !== name)
            : [...currentNames.filter((entry) => entry !== name), name];
          return { ...current, [field]: names };
        });

        const comparable = (value) => JSON.stringify({
          ...value,
          disabledSkills: [...value.disabledSkills].sort(),
          disabledMcpServers: [...value.disabledMcpServers].sort(),
        });
        const dirty = config !== undefined
          && savedConfig !== undefined
          && comparable(config) !== comparable(savedConfig);

        const save = async () => {
          setSaving(true);
          setStatus('保存中…');
          setError('');
          try {
            const result = await ctx.remote.settings.update('pi-settings', {
              disabledSkills: config.disabledSkills,
              disabledMcpServers: config.disabledMcpServers,
              retainTokens: config.compaction.retainTokens,
              headroomTokens: config.compaction.headroomTokens,
              thresholdRatio: config.compaction.thresholdRatio,
              maxTokens: config.compaction.maxTokens,
            }, revision);
            if (result.ok !== true) throw new Error(result.error?.message ?? '保存失败');
            const next = fromNamespace(result.value);
            setConfig(next);
            setSavedConfig(next);
            setRevision(result.value.revision);
            setStatus('已保存；下一次请求生效');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
            setStatus('');
          } finally {
            setSaving(false);
          }
        };

        const disabledSkills = new Set(config.disabledSkills);
        const disabledMcpServers = new Set(config.disabledMcpServers);
        const enabledSkills = availableSkills.filter((skill) => !disabledSkills.has(skill.name));
        const closedSkills = availableSkills.filter((skill) => disabledSkills.has(skill.name));
        const enabledMcp = config.availableMcpServers.filter((server) => !disabledMcpServers.has(server.name));
        const closedMcp = config.availableMcpServers.filter((server) => disabledMcpServers.has(server.name));

        const row = (key, content, first) => h('div', {
          key,
          className: 'pi-config-row',
          style: first ? styles.row : { ...styles.row, ...styles.rowBorder },
        }, content);

        const skillRow = (skill, checked, first) => row(`skill-${skill.name}`, [
          h(IconTile, { key: 'icon', kind: 'skill' }),
          h('div', { key: 'text', style: styles.rowText },
            h('span', { style: styles.name, title: skill.name }, skill.name),
            skill.description ? h('span', { style: styles.description }, skill.description) : null),
          h(Toggle, {
            key: 'toggle',
            checked,
            disabled: false,
            label: skill.name,
            onChange: (event) => toggleName('disabledSkills', skill.name, event.target.checked),
          }),
        ], first);

        const closedSkillRows = closedSkills.length === 0 ? null : h('div', { key: 'closed-skills' },
          h('button', {
            type: 'button',
            className: 'pi-config-closed',
            style: styles.closedButton,
            'aria-expanded': !collapsed.closedSkills,
            onClick: () => toggleGroup('closedSkills'),
          },
            h('span', { className: 'pi-config-chevron', style: { ...styles.chevron, transform: collapsed.closedSkills ? 'rotate(-90deg)' : 'none' } }, '⌄'),
            h('span', null, `已关闭的 Skills · ${closedSkills.length}`)),
          collapsed.closedSkills ? null : h('div', { style: styles.card }, closedSkills.map((skill, index) => skillRow(skill, false, index === 0))));

        const mcpRow = (server, checked, first) => row(`mcp-${server.name}`, [
          h(IconTile, { key: 'icon', kind: 'mcp' }),
          h('div', { key: 'text', style: styles.rowText },
            h('span', { style: styles.name, title: server.name }, server.name),
            h('span', { style: styles.description }, server.description || 'MCP server')),
          h(Toggle, {
            key: 'toggle',
            checked,
            disabled: false,
            label: server.name,
            onChange: (event) => toggleName('disabledMcpServers', server.name, event.target.checked),
          }),
        ], first);

        const skillsCard = enabledSkills.length > 0
          ? h('div', { style: styles.card }, enabledSkills.map((skill, index) => skillRow(skill, true, index === 0)))
          : skillError !== ''
            ? h('div', { style: styles.card }, h('div', { style: styles.error }, skillError))
            : h('div', { style: styles.card }, h('div', { style: styles.empty }, '没有模型可见的 skill。'));

        const mcpCard = enabledMcp.length > 0
          ? h('div', { style: styles.card }, enabledMcp.map((server, index) => mcpRow(server, true, index === 0)))
          : h('div', { style: styles.card }, h('div', { style: styles.empty }, '没有启用的 MCP server。'));
        const closedMcpCard = closedMcp.length === 0 ? null : h('div', { key: 'closed-mcp' },
          h('button', {
            type: 'button',
            className: 'pi-config-closed',
            style: styles.closedButton,
            'aria-expanded': !collapsed.closedMcp,
            onClick: () => toggleGroup('closedMcp'),
          },
            h('span', { className: 'pi-config-chevron', style: { ...styles.chevron, transform: collapsed.closedMcp ? 'rotate(-90deg)' : 'none' } }, '⌄'),
            h('span', null, `已关闭的 MCP · ${closedMcp.length}`)),
          collapsed.closedMcp ? null : h('div', { style: styles.card }, closedMcp.map((server, index) => mcpRow(server, false, index === 0))));

        const sectionHeader = (title, hint, key) => h('button', {
          type: 'button',
          className: 'pi-config-group-head',
          style: styles.groupHeaderButton,
          'aria-expanded': !collapsed[key],
          onClick: () => toggleGroup(key),
        },
          h('span', { className: 'pi-config-chevron', style: { ...styles.chevron, transform: collapsed[key] ? 'rotate(-90deg)' : 'none' } }, '⌄'),
          h('div', { style: styles.groupHeading },
            h('div', { style: styles.groupTitle }, title),
            h('div', { style: styles.groupHint }, hint)));

        return h('div', { className: 'pi-config-view', style: styles.root, 'data-pi-config-view': 'true' },
          h('div', { style: styles.header },
            h('h2', { style: styles.title }, 'Pi 配置'),
            h('p', { style: styles.hint }, '作用于整个 Pi 模式（所有 Pi 会话）；下一次请求/压缩生效。')),
          h('section', { style: styles.group },
            sectionHeader('Skills', `模型可见 skill · ${availableSkills.length}`, 'skills'),
            collapsed.skills ? null : skillsCard,
            closedSkillRows),
          h('section', { style: styles.group },
            sectionHeader('MCP servers', `来自 ~/.pi/agent/mcp.json · ${config.availableMcpServers.length}`, 'mcp'),
            collapsed.mcp ? null : mcpCard,
            closedMcpCard),
          h('section', { style: styles.group },
            sectionHeader('Compaction', '摘要保留量与触发阈值', 'compaction'),
            collapsed.compaction ? null : h('div', { style: styles.card },
              h('div', { className: 'pi-config-row', style: styles.fieldRow },
                h('div', { style: styles.rowText },
                  h('span', { style: styles.name }, '保留 token'),
                  h('span', { style: styles.description }, 'retainTokens · 压缩后保留的近期上下文')),
                h('input', {
                  type: 'number', min: 0, step: 1000, className: 'pi-config-input', style: styles.fieldInput,
                  value: config.compaction.retainTokens,
                  onChange: (event) => updateCompaction({ retainTokens: Number(event.target.value) }),
                })),
              h('div', { className: 'pi-config-row', style: { ...styles.fieldRow, ...styles.rowBorder } },
                h('div', { style: styles.rowText },
                  h('span', { style: styles.name }, '预留 token'),
                  h('span', { style: styles.description }, 'headroomTokens · 为下一次请求预留的空间')),
                h('input', {
                  type: 'number', min: 0, step: 1000, className: 'pi-config-input', style: styles.fieldInput,
                  value: config.compaction.headroomTokens,
                  onChange: (event) => updateCompaction({ headroomTokens: Number(event.target.value) }),
                })),
              h('div', { className: 'pi-config-row', style: { ...styles.fieldRow, ...styles.rowBorder } },
                h('div', { style: styles.rowText },
                  h('span', { style: styles.name }, '触发比例'),
                  h('span', { style: styles.description }, 'thresholdRatio · 达到上下文比例时触发')),
                h('div', { style: styles.segments }, THRESHOLD_OPTIONS.map((value) => {
                  const active = Math.abs(Number(config.compaction.thresholdRatio) - value) < 1e-9;
                  return h('button', {
                    key: value,
                    type: 'button',
                    className: active ? 'pi-config-segment pi-config-segment-active' : 'pi-config-segment',
                    'aria-pressed': active,
                    style: { ...styles.segment, ...(active ? styles.segmentActive : {}) },
                    onClick: () => updateCompaction({ thresholdRatio: value }),
                  }, `${Math.round(value * 100)}%`);
                }))),
              h('div', { className: 'pi-config-row', style: { ...styles.fieldRow, ...styles.rowBorder } },
                h('div', { style: styles.rowText },
                  h('span', { style: styles.name }, '最大摘要 token'),
                  h('span', { style: styles.description }, 'maxTokens · 单次摘要的上限')),
                h('input', {
                  type: 'number', min: 1, step: 1000, className: 'pi-config-input', style: styles.fieldInput,
                  value: config.compaction.maxTokens,
                  onChange: (event) => updateCompaction({ maxTokens: Number(event.target.value) }),
                })))),
          h('div', { style: styles.footer },
            h('button', {
              type: 'button',
              className: 'pi-config-save',
              disabled: saving || !dirty,
              onClick: save,
              style: { ...styles.button, opacity: saving || !dirty ? 0.45 : 1, cursor: saving || !dirty ? 'not-allowed' : 'pointer' },
            }, saving ? '保存中…' : '保存'),
            status !== '' ? h('span', { style: styles.status }, status) : null),
          error !== '' ? h('div', { style: styles.error }, error) : null);
      }

      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'pi-config',
        order: 5,
        label: 'Pi 配置',
      }, PiConfigView));
    }

    return { inject: ['slots', 'remote', 'remote.settings', 'remote.skills'], apply };
  },
});
