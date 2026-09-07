/**
 * dsh-approval-core — 自动审批审查界面（浏览器端 bundle）
 *
 * 提供两处 UI（严格按 DSH 设计语言，--dsw-alias-* tokens）：
 * 1. ✅ 自动放行提示条：conversation.input.dock（输入框上方独立行，order=30，
 *    排在 todo/goal/queue 之下；无事件时完全隐藏不占位；不随流式对话滚动）
 * 2. 「审批」历史视图：conversation.view（order=20，chat=0/trajectory=10 →
 *    tab 显示在「轨迹」右侧），展示当前会话所有自动放行的动作时间线
 *    （命令、原因、涉及文件、判定路径、时间）
 *
 * 数据源：轮询 host 提供的 GET /api/auto-approve/events?sessionId=&since=
 * （events.jsonl 由 host 插件在每次自动放行时追加）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-approval-core',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')

    const CSS = `
.ag-notice{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto;flex:none}
.ag-notice-card{box-sizing:border-box;display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:6px 10px 6px 12px;box-shadow:var(--dsw-shadow-lv1)}
.ag-notice-card-pending{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}
.ag-notice-card-manual{border-color:var(--dsw-alias-state-warn-primary)}
.ag-notice-glyph{color:var(--dsw-alias-state-success-primary);flex:none;display:inline-flex;align-items:center;justify-content:center}
.ag-notice-glyph-warn{color:var(--dsw-alias-state-warn-label);flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:16px;width:16px;height:16px}
.ag-notice-glyph-err{color:var(--dsw-alias-state-error-primary);flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:13px;line-height:16px;width:16px;height:16px}
.ag-notice-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.ag-notice-head{display:flex;align-items:center;gap:8px;min-width:0}
.ag-notice-tool{flex:none;color:var(--dsw-alias-label-primary);font:500 12px/18px var(--ds-font-family-code)}
.ag-notice-text{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.ag-notice-meta{display:flex;align-items:center;gap:8px}
.ag-tag{box-sizing:border-box;flex:none;height:18px;color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary);border-radius:9px;align-items:center;padding:0 8px;font-size:11px;line-height:18px;display:inline-flex;letter-spacing:.02em}
.ag-tag-neutral{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform)}
.ag-tag-warn{box-sizing:border-box;flex:none;height:18px;color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary);border-radius:9px;align-items:center;padding:0 8px;font-size:11px;line-height:18px;display:inline-flex;letter-spacing:.02em}
.ag-tag-err{box-sizing:border-box;flex:none;height:18px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger);border-radius:9px;align-items:center;padding:0 8px;font-size:11px;line-height:18px;display:inline-flex;letter-spacing:.02em}
.ag-time{flex:none;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}
.ag-notice-close{width:24px;height:24px;flex:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;padding:0}
.ag-notice-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.ag-view{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);position:relative}
.ag-view::after{content:"";pointer-events:none;position:absolute;left:0;right:0;bottom:0;height:32px;z-index:3;background:linear-gradient(180deg, color-mix(in srgb, var(--dsw-alias-bg-layer-1) 0%, transparent) 0px, var(--dsw-alias-bg-layer-1) 32px)}
.ag-view-head{box-sizing:border-box;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);padding:10px 14px 8px;display:flex;flex-direction:column;gap:2px}
.ag-view-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}
.ag-view-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.ag-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 14px 48px;display:flex;flex-direction:column;gap:2px}
.ag-row{box-sizing:border-box;display:flex;gap:10px;padding:9px 10px;border-radius:10px;transition:background .1s ease}
.ag-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ag-row-rail{flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:2px}
.ag-row-glyph{color:var(--dsw-alias-state-success-primary);flex:none;display:inline-flex}
.ag-row-glyph-warn{color:var(--dsw-alias-state-warn-label);flex:none;display:inline-flex;font-size:12px;line-height:16px;width:14px;height:14px;align-items:center;justify-content:center}
.ag-row-glyph-err{color:var(--dsw-alias-state-error-primary);flex:none;display:inline-flex;font-size:12px;line-height:16px;width:14px;height:14px;align-items:center;justify-content:center}
.ag-row-line{flex:1 1 auto;flex:none;width:1px;background:var(--dsw-alias-border-l1);min-height:10px}
.ag-row:last-child .ag-row-line{display:none}
.ag-row-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px}
.ag-row-top{display:flex;align-items:center;gap:8px;min-width:0}
.ag-row-tool{flex:none;color:var(--dsw-alias-label-primary);font:500 12px/18px var(--ds-font-family-code)}
.ag-row-reason{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;word-break:break-all;white-space:pre-wrap}
.ag-row-files{display:flex;flex-wrap:wrap;gap:4px}
.ag-file-chip{box-sizing:border-box;max-width:260px;height:20px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;align-items:center;padding:0 7px;font:11px/18px var(--ds-font-family-code);display:inline-flex;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.ag-empty{flex:1 1 auto;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;line-height:20px;padding:24px}
.ag-loading{flex:1 1 auto;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:center;font-size:13px;line-height:20px;padding:24px}
.ag-mono{font-family:var(--ds-font-family-code)}
.ag-set{box-sizing:border-box;width:100%;max-width:720px;padding:0 0 28px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.ag-set-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.ag-set-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.ag-set-card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:12px;padding:12px 14px;display:flex}
.ag-set-card-head{flex-direction:column;gap:4px;display:flex}
.ag-set-card-title{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;font-size:14px;font-weight:500;line-height:20px;display:flex}
.ag-set-stage{box-sizing:border-box;flex:none;height:20px;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary);border-radius:10px;align-items:center;padding:0 8px;font-size:11px;font-weight:500;line-height:20px;display:inline-flex;letter-spacing:.02em}
.ag-set-card-sub{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.ag-set-note{color:var(--dsw-alias-state-warn-label);margin:0;font-size:13px;line-height:20px}
.ag-set-ok{color:var(--dsw-alias-state-success-primary);margin:0;font-size:13px;line-height:20px}
.ag-set-err{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px;line-height:20px}
.ag-set-row{flex-wrap:wrap;gap:8px;display:flex}
.ag-set-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);height:32px;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;padding:0 10px;font-size:13px;line-height:20px;font-family:var(--ds-font-family-code)}
.ag-set-input:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}
.ag-set-input::placeholder{color:var(--dsw-alias-label-caption)}
.ag-set-input-num{width:96px}
.ag-set-btn{box-sizing:border-box;height:32px;color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;border:1px solid var(--dsw-alias-border-l2);background:transparent;border-radius:16px;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:13px;line-height:20px;display:inline-flex;white-space:nowrap}
.ag-set-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ag-set-btn:disabled{opacity:.4;cursor:default}
.ag-set-btn-primary{border:none;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.ag-set-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.ag-set-btn-danger{color:var(--dsw-alias-state-error-primary)}
.ag-set-btn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.ag-set-btn-confirm{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary)}
.ag-set-list{flex-direction:column;gap:6px;display:flex}
.ag-set-item{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;align-items:center;gap:8px;padding:6px 10px;min-width:0;display:flex}
.ag-set-item-label{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);word-break:break-all}
.ag-set-item-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
.ag-set-item-del{flex:none;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;padding:0}
.ag-set-item-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.ag-set-item-del-confirm{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label);width:auto;padding:0 8px;border-radius:9px}
.ag-set-empty{color:var(--dsw-alias-label-caption);margin:0;font-size:13px;line-height:20px;padding:4px 2px}
.ag-set-tag{box-sizing:border-box;flex:none;height:18px;border-radius:9px;align-items:center;padding:0 8px;font-size:11px;line-height:18px;display:inline-flex;letter-spacing:.02em}
.ag-set-tag-blue{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}
.ag-set-tag-green{color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary)}
.ag-set-tag-gray{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform)}
.ag-set-tag-red{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.ag-set-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;display:grid}
.ag-set-hc{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;color:var(--dsw-alias-label-secondary);align-items:center;justify-content:center;gap:6px;height:30px;font-size:12px;line-height:18px;display:inline-flex}
.ag-set-learn{flex-direction:column;gap:8px;display:flex}
.ag-set-learn-item{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;align-items:center;gap:8px;padding:6px 10px;min-width:0;display:flex}
.ag-set-learn-info{flex:1 1 auto;min-width:0;flex-direction:column;gap:2px;display:flex}
.ag-set-learn-key{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);word-break:break-all}
.ag-set-learn-sub{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.ag-set-learn-stop{flex:none;height:24px;color:var(--dsw-alias-state-error-primary);cursor:pointer;font:inherit;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;align-items:center;padding:0 10px;font-size:12px;line-height:24px;display:inline-flex;white-space:nowrap}
.ag-set-learn-stop:hover{background:var(--dsw-alias-interactive-bg-hover-danger)}
.ag-diff-overlay{position:fixed;inset:0;z-index:900;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.ag-diff-panel{box-sizing:border-box;width:min(760px,calc(100vw - 48px));max-height:min(720px,calc(100vh - 48px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;box-shadow:var(--dsw-shadow-lv3);overflow:hidden}
.ag-diff-head{box-sizing:border-box;flex:none;border-bottom:1px solid var(--dsw-alias-border-l2);padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.ag-diff-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;display:flex;align-items:center;gap:8px}
.ag-diff-path{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);word-break:break-all}
.ag-diff-stats{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.ag-diff-stats-add{color:var(--dsw-alias-state-success-primary)}
.ag-diff-stats-del{color:var(--dsw-alias-state-error-primary)}
.ag-diff-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;font-family:var(--ds-font-family-code);font-size:12px;line-height:19px}
.ag-diff-line{box-sizing:border-box;display:flex;gap:8px;padding:1px 8px;white-space:pre-wrap;word-break:break-all;min-width:0}
.ag-diff-line-add{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}
.ag-diff-line-del{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.ag-diff-line-ctx{background:transparent;color:var(--dsw-alias-label-secondary)}
.ag-diff-line-add .ag-diff-marker{color:var(--dsw-alias-state-success-primary)}
.ag-diff-line-del .ag-diff-marker{color:var(--dsw-alias-state-error-primary)}
.ag-diff-line-ctx .ag-diff-marker{color:var(--dsw-alias-label-tertiary)}
.ag-diff-marker{flex:none;width:16px;user-select:none}
.ag-diff-line-no{flex:none;width:52px;color:var(--dsw-alias-label-caption);text-align:right;user-select:none;font-variant-numeric:tabular-nums}
.ag-diff-text{flex:1 1 auto;min-width:0}
.ag-diff-hunk-sep{box-sizing:border-box;flex:none;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;padding:2px 8px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);margin:2px 0;user-select:none}
.ag-diff-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;padding:16px;text-align:center}
.ag-diff-foot{box-sizing:border-box;flex:none;border-top:1px solid var(--dsw-alias-border-l2);padding:10px 14px;display:flex;align-items:center;gap:8px;justify-content:flex-end}
.ag-file-chip-snap{cursor:pointer;background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary)}
.ag-file-chip-snap:hover{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}
.ag-snap-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;flex-wrap:wrap}
.ag-snap-bar b{color:var(--dsw-alias-label-secondary);font-weight:500}
.ag-snap-bar-spacer{flex:1 1 auto}
`

    const VERDICT_LABELS = {
      rule: '白名单规则',
      'flash-safe': 'Flash 判定安全',
      learned: '沉淀规则',
      fpHit: '已确认操作',
      'flash-same': 'Flash 同类验证'
    }
    const VERDICT_NEUTRAL = new Set(['rule', 'learned', 'fpHit', 'flash-same'])
    const HARD_CATEGORIES = new Set(['deletion', 'credential', 'remote', 'system', 'bulk'])

    // 拒绝记录文案：按 host 记录的 path（判定路径）精确分类
    function rejectLabel(ev) {
      const p = ev && ev.path
      if (p === 'hard-category') return '人工拒绝（硬风险类别，本就永久人工）'
      if (p === 'unknown-category') return '人工拒绝（协议外类别，不升级）'
      if (p === 'deny-rule') return '人工拒绝（永久人工规则命中）'
      if (p === 'neutral-reject' || (ev && ev.category === 'neutral')) return '人工拒绝 · 已升级永久人工'
      // 兜底：旧事件无 path——按 category 兼容
      if (ev && HARD_CATEGORIES.has(ev.category)) return '人工拒绝（硬风险类别，本就永久人工）'
      return '人工拒绝'
    }

    function fmtTime(iso) {
      try {
        const d = new Date(iso)
        const p = (n) => String(n).padStart(2, '0')
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      } catch (e) { return String(iso || '') }
    }

    function GlyphCheck() {
      return React.createElement('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
      },
        React.createElement('circle', { cx: 8, cy: 8, r: 7, fill: 'var(--dsw-alias-state-success-tertiary)' }),
        React.createElement('path', { d: 'M5 8.3L7.1 10.4L11 6', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    function resolveFrame(sp) {
      let sessionId = (sp && sp.sessionId) || null
      try {
        if (!sessionId && sp && typeof sp.useSessions === 'function') {
          const state = sp.useSessions(function (s) { return s })
          sessionId = (state && state.current) || null
        }
      } catch (e) {}
      return { sessionId }
    }

    function fetchEvents(sessionId, since) {
      const q = '/api/auto-approve/events?sessionId=' + encodeURIComponent(sessionId || '') + (since ? '&since=' + since : '')
      return fetch(q, { headers: { 'cache-control': 'no-cache' } }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      }).then(function (data) {
        return (data && Array.isArray(data.events)) ? data.events : []
      })
    }

    // ================= ✅ 自动放行提示条（conversation.input.dock，order=30） =================
    function NoticeStrip(props) {
      const frame = resolveFrame(props.slotsProps || {})
      const sessionId = frame.sessionId
      const [notice, setNotice] = React.useState(null)
      const sinceRef = React.useRef(0)
      const lastShownIdRef = React.useRef(0) // 已弹过的事件最大 id（跨会话全局递增，防重复弹历史）
      const hideTimerRef = React.useRef(null)

      React.useEffect(function () {
        let alive = true
        let timer = null
        sinceRef.current = 0
        setNotice(null)
        if (!sessionId) return

        // 轮询主体：拉取游标之后的新事件；去重兜底（id 不大于已弹过的最大 id 直接跳过）
        const startPolling = function () {
          if (!alive) return
          timer = setInterval(function () {
            fetchEvents(sessionId, sinceRef.current).then(function (evs) {
              if (!alive) return
              if (evs.length === 0) return
              const last = evs[evs.length - 1]
              if (!last || last.id <= lastShownIdRef.current) return
              lastShownIdRef.current = last.id
              sinceRef.current = last.id
              const kind = last.kind || 'auto'
              setNotice(last)
              // pending（等待人工审批）不自动收起；其余按类型定时收起
              if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
              if (kind !== 'manual-pending') {
                const hold = kind === 'manual-approved' ? 5000 : 4000
                hideTimerRef.current = setTimeout(function () { setNotice(null) }, hold)
              }
            }).catch(function () {})
          }, 2000)
        }

        // 打开会话：先静默拉一次全量，仅把游标推进到最新，不弹任何历史提示；完成后再开始轮询
        fetchEvents(sessionId, 0).then(function (evs) {
          if (!alive) return
          if (evs.length > 0) sinceRef.current = evs[evs.length - 1].id
          startPolling()
        }).catch(function () {
          // 静默拉取失败：游标保持 0，靠 lastShownIdRef 去重兜底，仍启动轮询
          if (!alive) return
          startPolling()
        })

        return function () {
          alive = false
          if (timer) clearInterval(timer)
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
        }
      }, [sessionId])

      if (!notice) return null
      const kind = notice.kind || 'auto'
      const isPending = kind === 'manual-pending'
      const isManual = kind === 'manual-approved' || kind === 'manual-rejected'
      // 文案
      let title = ''
      let tagText = ''
      let glyph = null
      if (isPending) {
        title = '等待人工审批：' + (notice.justification || notice.reason || '')
        tagText = '人工审批中'
        glyph = React.createElement('span', { className: 'ag-notice-glyph-warn' }, '◔')
      } else if (kind === 'manual-approved') {
        const lc = notice.learningCount !== undefined ? notice.learningCount : null
        const th = notice.threshold || 3
        title = '人工审批通过：' + (notice.justification || notice.reason || '')
        tagText = lc !== null ? ('学习 ' + lc + '/' + th + '，满 ' + th + ' 次后自动放行') : '人工审批通过'
        glyph = React.createElement('span', { className: 'ag-notice-glyph-warn' }, '✓')
      } else if (kind === 'manual-rejected') {
        title = '已拒绝：' + (notice.justification || notice.reason || '')
        tagText = rejectLabel(notice).replace('人工拒绝', '已拒绝')
        glyph = React.createElement('span', { className: 'ag-notice-glyph-err' }, '✕')
      } else {
        title = (notice.justification || notice.reason || '')
        const label = VERDICT_LABELS[notice.verdict] || notice.verdict || '自动放行'
        tagText = '自动放行 · ' + label
        glyph = React.createElement(GlyphCheck, null)
      }
      const cardCls = 'ag-notice-card' + (isPending ? ' ag-notice-card-pending' : isManual ? ' ag-notice-card-manual' : '')
      return React.createElement('div', { className: 'ag-notice' },
        React.createElement('div', { className: cardCls },
          React.createElement('span', { className: 'ag-notice-glyph' }, glyph),
          React.createElement('div', { className: 'ag-notice-body' },
            React.createElement('div', { className: 'ag-notice-head' },
              React.createElement('span', { className: 'ag-notice-tool' }, notice.tool || 'tool'),
              React.createElement('span', { className: 'ag-notice-text' }, title),
            ),
            React.createElement('div', { className: 'ag-notice-meta' },
              React.createElement('span', { className: isPending ? 'ag-tag-warn' : kind === 'manual-rejected' ? 'ag-tag-err' : kind === 'manual-approved' ? 'ag-tag-warn' : 'ag-tag' + (VERDICT_NEUTRAL.has(notice.verdict) ? ' ag-tag-neutral' : '') }, tagText),
              React.createElement('span', { className: 'ag-time' }, fmtTime(notice.ts)),
            ),
          ),
          React.createElement('button', {
            type: 'button',
            className: 'ag-notice-close',
            title: '关闭提示',
            'aria-label': '关闭提示',
            onClick: function () { setNotice(null) },
          }, '✕'),
        ),
      )
    }

    // ================= diff 面板（审批记录文件改动查看 + 撤销） =================
    function fmtBytes(n) {
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(2) + ' MB'
    }

    function DiffPanel(props) {
      const sessionId = props.sessionId
      const eventId = props.eventId
      const path = props.path
      const onClose = props.onClose
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [revertMsg, setRevertMsg] = React.useState(null)
      const [reverting, setReverting] = React.useState(false)
      const [revertDone, setRevertDone] = React.useState(false)

      React.useEffect(function () {
        setData(null)
        setError(null)
        setRevertDone(false)
        fetch('/api/auto-approve/diff?eventId=' + eventId + '&path=' + encodeURIComponent(path), { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (res && res.ok) setData(res)
            else setError((res && res.error) || '加载 diff 失败')
          })
          .catch(function (e) { setError('加载 diff 失败：' + String((e && e.message) || e)) })
      }, [eventId, path])

      const doRevert = function () {
        // 防重复：同一事件只允许投递一次撤销指令（v0.5.0 事故中同一 event 被重复撤销 4 次）
        if (reverting || revertDone) return
        setReverting(true)
        setRevertMsg(null)
        fetch('/api/auto-approve/revert', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId, eventId: eventId }),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) {
            setRevertMsg('撤销指令已发送到对话框，AI 将按指令恢复文件')
            setRevertDone(true)
          } else {
            setRevertMsg((res && res.error) || '发送失败')
          }
        }).catch(function (e) {
          setRevertMsg('发送失败：' + String((e && e.message) || e))
        }).finally(function () {
          setReverting(false)
        })
      }

      const changedLines = data ? (data.changedLines || []) : []
      const hunks = data && Array.isArray(data.hunks) ? data.hunks : null
      const stats = data ? (data.stats || {}) : null

      return React.createElement('div', { className: 'ag-diff-overlay', onClick: function (e) { if (e.target === e.currentTarget) onClose() } },
        React.createElement('div', { className: 'ag-diff-panel' },
          React.createElement('div', { className: 'ag-diff-head' },
            React.createElement('div', { className: 'ag-diff-title' },
              React.createElement('span', null, '文件改动对比（事件 #' + eventId + '）'),
              React.createElement('button', { type: 'button', className: 'ag-notice-close', title: '关闭', 'aria-label': '关闭', onClick: onClose }, '✕'),
            ),
            React.createElement('div', { className: 'ag-diff-path' }, path),
            stats
              ? React.createElement('div', { className: 'ag-diff-stats' },
                  React.createElement('span', { className: 'ag-diff-stats-add' }, '+' + stats.added),
                  ' / ',
                  React.createElement('span', { className: 'ag-diff-stats-del' }, '-' + stats.removed),
                  ' 行变更 · ' + stats.contextLines + ' 行未变' + (data.afterExists === false ? '（文件当前已不存在）' : ''),
                )
              : null,
          ),
          React.createElement('div', { className: 'ag-diff-body' },
            error
              ? React.createElement('div', { className: 'ag-diff-empty' }, error)
              : !data
                ? React.createElement('div', { className: 'ag-diff-empty' }, '加载中…')
                : hunks
                  ? hunks.map(function (h, hi) {
                      return React.createElement('div', { key: 'hunk' + hi },
                        h.hiddenBefore > 0
                          ? React.createElement('div', { className: 'ag-diff-hunk-sep' }, h.hiddenBefore + ' unmodified lines')
                          : null,
                        h.lines.map(function (c, i) {
                          const isAdd = c.type === 'add'
                          const isDel = c.type === 'del'
                          const cls = isAdd ? 'ag-diff-line-add' : (isDel ? 'ag-diff-line-del' : 'ag-diff-line-ctx')
                          const marker = isAdd ? '+' : (isDel ? '-' : ' ')
                          const aNo = c.aNo != null ? String(c.aNo) : ''
                          const bNo = c.bNo != null ? String(c.bNo) : ''
                          return React.createElement('div', { className: 'ag-diff-line ' + cls, key: 'hl' + i },
                            React.createElement('span', { className: 'ag-diff-marker' }, marker),
                            React.createElement('span', { className: 'ag-diff-line-no' }, aNo + (aNo && bNo ? ' ' : '') + bNo),
                            React.createElement('span', { className: 'ag-diff-text' }, c.text),
                          )
                        }),
                      )
                    })
                  : changedLines.length === 0
                    ? React.createElement('div', { className: 'ag-diff-empty' }, '该文件无内容变化（或文件不可读）')
                    : changedLines.map(function (c, i) {
                        return React.createElement('div', {
                          className: 'ag-diff-line ' + (c.type === 'add' ? 'ag-diff-line-add' : 'ag-diff-line-del'),
                          key: i,
                        },
                          React.createElement('span', { className: 'ag-diff-marker' }, c.type === 'add' ? '+' : '-'),
                          React.createElement('span', { className: 'ag-diff-line-no' }, String(c.line)),
                          React.createElement('span', { className: 'ag-diff-text' }, c.text),
                        )
                      }),
          ),
          React.createElement('div', { className: 'ag-diff-foot' },
            revertMsg
              ? React.createElement('span', { className: revertMsg.indexOf('已发送') === 0 ? 'ag-set-ok' : 'ag-set-err' }, revertMsg)
              : null,
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn ag-set-btn-primary',
              onClick: doRevert,
              disabled: reverting || revertDone,
            }, reverting ? '发送中…' : (revertDone ? '已发送撤销指令' : '撤销此改动')),
            React.createElement('button', { type: 'button', className: 'ag-set-btn', onClick: onClose }, '关闭'),
          ),
        ),
      )
    }

    // ================= 审批历史视图（conversation.view，order=20，轨迹右侧） =================
    function HistoryView(props) {
      const sessionId = (props && (props.sessionId || (props.slotsProps && props.slotsProps.sessionId))) || null
      const [events, setEvents] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [snapStats, setSnapStats] = React.useState(null) // {count, bytes} | null
      const [snapIds, setSnapIds] = React.useState(null) // Set<eventId> | null（当前存在快照的事件）
      const [diffOpen, setDiffOpen] = React.useState(null) // {eventId, path} | null
      // 快照清理的两段式确认（替代 window.confirm，避免 Electron 焦点丢失）
      const [pendingSnapClear, setPendingSnapClear] = React.useState(null) // 'session' | 'all' | null
      const snapClearTimerRef = React.useRef(null)
      const armSnapClear = function (mode) {
        setPendingSnapClear(mode)
        if (snapClearTimerRef.current) clearTimeout(snapClearTimerRef.current)
        snapClearTimerRef.current = setTimeout(function () { setPendingSnapClear(null) }, 3000)
      }
      const disarmSnapClear = function () {
        if (snapClearTimerRef.current) clearTimeout(snapClearTimerRef.current)
        setPendingSnapClear(null)
      }
      React.useEffect(function () {
        return function () { if (snapClearTimerRef.current) clearTimeout(snapClearTimerRef.current) }
      }, [])

      const loadSnapStats = function (sid) {
        const q = sid ? ('?sessionId=' + encodeURIComponent(sid)) : ''
        fetch('/api/auto-approve/snapshots-stats' + q, { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (res) {
            if (!res || !res.ok) return
            setSnapStats({ count: res.count || 0, bytes: res.bytes || 0 })
            setSnapIds(new Set((res.ids || []).map(String)))
          })
          .catch(function () {})
      }

      // 清除快照：mode='session' 仅本会话（默认），mode='all' 清全部（含其他会话，需两段式二次确认）
      const doClearSnapshots = function (mode) {
        if (pendingSnapClear !== mode) { armSnapClear(mode); return }
        disarmSnapClear()
        const sid = mode === 'session' ? sessionId : ''
        const body = {}
        if (sid) body.sessionId = sid
        fetch('/api/auto-approve/snapshots-clear', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) {
            if (mode === 'all') { setSnapStats({ count: 0, bytes: 0 }); setSnapIds(new Set()) }
            else loadSnapStats(sessionId)
          }
        }).catch(function () {})
      }

      React.useEffect(function () {
        setEvents(null)
        setError(null)
        loadSnapStats(sessionId)
        if (!sessionId) { setEvents([]); return }
        let alive = true
        const load = function () {
          fetchEvents(sessionId, 0).then(function (evs) {
            if (!alive) return
            evs.sort(function (a, b) { return b.id - a.id }) // 时间倒序：最新在最上面
            setEvents(evs)
            setError(null)
          }).catch(function (e) {
            if (!alive) return
            setError(String((e && e.message) || e))
          })
          loadSnapStats(sessionId)
        }
        load()
        const timer = setInterval(load, 5000)
        return function () { alive = false; clearInterval(timer) }
      }, [sessionId])

      // data-conversation-composer-overlay：宿主布局钩子——声明后审批视图占满内容区
      // （scrollBody 锁滚动），聊天输入框变为覆盖在视图底部的浮层（与聊天 tab 视觉一致）。
      // 不声明时视图被压缩、输入框 sticky 悬浮其下（v0.2.0 真机发现的布局现象）。
      return React.createElement('div', { className: 'ag-view', 'data-conversation-composer-overlay': '' },
        React.createElement('div', { className: 'ag-view-head' },
          React.createElement('div', { className: 'ag-view-title' }, '自动放行审批'),
          React.createElement('div', { className: 'ag-view-sub' }, '本会话中自动放行与人工审批的记录（最新在上）'),
        ),
        React.createElement('div', { className: 'ag-snap-bar' },
          React.createElement('span', null,
            'diff 快照 ',
            React.createElement('b', null, snapStats ? (fmtBytes(snapStats.bytes) + ' · ' + snapStats.count + ' 条') : '…'),
          ),
          React.createElement('span', { className: 'ag-snap-bar-spacer' }),
          React.createElement('button', {
            type: 'button',
            className: 'ag-set-btn' + (pendingSnapClear === 'session' ? ' ag-set-btn-confirm' : ''),
            onClick: function () { doClearSnapshots('session') },
            disabled: !snapStats || snapStats.count === 0,
            title: '仅清除本会话的 diff 快照（不影响其他会话）',
          }, pendingSnapClear === 'session' ? '确认清除？' : '仅清本会话'),
          React.createElement('button', {
            type: 'button',
            className: 'ag-set-btn ag-set-btn-danger' + (pendingSnapClear === 'all' ? ' ag-set-btn-confirm' : ''),
            onClick: function () { doClearSnapshots('all') },
            disabled: !snapStats || snapStats.count === 0,
            title: '清空全部会话（含其他会话未查看过的）diff 快照，点两次确认',
          }, pendingSnapClear === 'all' ? '确认清空？' : '清空全部'),
        ),
        events === null
          ? React.createElement('div', { className: 'ag-loading' }, '加载中…')
          : events.length === 0
            ? React.createElement('div', { className: 'ag-empty' }, error ? ('加载失败：' + error) : '本会话暂无审批记录')
            : React.createElement('div', { className: 'ag-list' },
                events.map(function (ev) {
                  const kind = ev.kind || 'auto'
                  // pending（等待中）不在视图展示终态记录（提示条负责）
                  if (kind === 'manual-pending') return null
                  const files = Array.isArray(ev.files) ? ev.files : []
                  // 快照挂在 pending 事件 id 下：本事件无快照时回退查其 snapshotEventId 指向的 pending 事件
                  const hasSnap = snapIds !== null && (snapIds.has(String(ev.id)) || (ev.snapshotEventId !== undefined && snapIds.has(String(ev.snapshotEventId))))
                  let tagText = ''
                  let tagCls = 'ag-tag'
                  let glyph = React.createElement(GlyphCheck, null)
                  let glyphCls = 'ag-row-glyph'
                  if (kind === 'manual-approved') {
                    const lc = ev.learningCount !== undefined ? ev.learningCount : null
                    const th = ev.threshold || 3
                    tagText = lc !== null ? ('人工通过 · 学习 ' + lc + '/' + th + '（满 ' + th + ' 次自动放行）') : '人工通过'
                    tagCls = 'ag-tag-warn'
                    glyphCls = 'ag-row-glyph-warn'
                    glyph = React.createElement('span', null, '✓')
                  } else if (kind === 'manual-rejected') {
                    // 按拒绝路径精确分类文案（reason 由 host 记录）
                    tagText = rejectLabel(ev)
                    tagCls = 'ag-tag-err'
                    glyphCls = 'ag-row-glyph-err'
                    glyph = React.createElement('span', null, '✕')
                  } else {
                    tagText = '自动放行 · ' + (VERDICT_LABELS[ev.verdict] || ev.verdict || 'auto')
                    tagCls = 'ag-tag' + (VERDICT_NEUTRAL.has(ev.verdict) ? ' ag-tag-neutral' : '')
                  }
                  return React.createElement('div', { className: 'ag-row', key: ev.id },
                    React.createElement('div', { className: 'ag-row-rail' },
                      React.createElement('span', { className: glyphCls }, glyph),
                      React.createElement('span', { className: 'ag-row-line' }),
                    ),
                    React.createElement('div', { className: 'ag-row-body' },
                      React.createElement('div', { className: 'ag-row-top' },
                        React.createElement('span', { className: 'ag-row-tool' }, ev.tool || 'tool'),
                        React.createElement('span', { className: tagCls }, tagText),
                        React.createElement('span', { className: 'ag-time' }, fmtTime(ev.ts)),
                      ),
                      React.createElement('div', { className: 'ag-row-reason' }, ev.justification || ev.reason || '(无说明)'),
                      files.length > 0
                        ? React.createElement('div', { className: 'ag-row-files' },
                            files.map(function (f, i) {
                              // 该事件存在快照 → 文件可点击查看改动对比
                              const chipProps = { key: i, className: 'ag-file-chip' }
                              if (hasSnap) {
                                chipProps.className += ' ag-file-chip-snap'
                                chipProps.title = '查看该文件改动对比'
                                chipProps.role = 'button'
                                // 快照按 pending 事件 id 存：有 snapshotEventId 的事件（approved 等）传它查 diff
                                chipProps.onClick = function () { setDiffOpen({ eventId: ev.snapshotEventId !== undefined ? ev.snapshotEventId : ev.id, path: f }) }
                              }
                              // 只显示文件名本身（去重后同一文件只有一个 chip）
                              const fname = String(f).split('/').pop()
                              return React.createElement('span', chipProps, fname)
                            }),
                          )
                        : null,
                    ),
                  )
                }).filter(Boolean),
              ),
        diffOpen
          ? React.createElement(DiffPanel, {
              sessionId: sessionId,
              eventId: diffOpen.eventId,
              path: diffOpen.path,
              onClose: function () { setDiffOpen(null) },
            })
          : null,
      )
    }

    // ================= 设置页：自动审批规则管理（settings.section，分级渲染） =================
    // v0.2.0：恢复完整设置页，按服务端四级权限矩阵（GET /rules 的 permission 元数据）渲染：
    //   hardCategories = forbidden → 只读网格，无任何增删控件；
    //   denyKeywords / allowRules / denyRules = confirm → 增删可用（add 弹确认框），预置项删除按钮 disabled；
    //   riskyThreshold / judgeTimeoutMs = free → 输入框直接保存（min/max 与服务端校验一致）。
    // 安全边界在服务端 classifyOp（预置删除/danger-full-access/硬类别一律 403），前端拦截只是体验层。
    // fork 自 dsh-approval-gate 0.5.2 的 RulesSettings：无 POST /setup（初始化卡片不需要，预设已配）、
    // 学习只读展示（服务端未开放 learning kind）、页尾数据目录/分类模型只读信息卡。
    const RULE_SOURCE_TAGS = {
      default: React.createElement('span', { className: 'ag-set-tag ag-set-tag-blue' }, '预置'),
      learned: React.createElement('span', { className: 'ag-set-tag ag-set-tag-green' }, '学习沉淀'),
      user: React.createElement('span', { className: 'ag-set-tag ag-set-tag-gray' }, '用户'),
    }
    function ruleSource(rule) {
      const d = String(rule && rule.description || '')
      if (d.indexOf('自动沉淀') === 0 || d.indexOf('人工确认后') >= 0 || d.indexOf('flash 同类') >= 0) return 'learned'
      if (d === '用户自定义') return 'user'
      return 'default'
    }

    // 与服务端 configRules.mjs 的 normalizeItem 同构：对象规则剥除 description 等一切非四键字段，
    // 仅保留固定键序的 tool/mode/category/contains（trim 后），用于预置项对照（键序一致可直接 JSON.stringify 比较）。
    function normalizeRule(item) {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        const out = {}
        for (const k of ['tool', 'mode', 'category', 'contains']) {
          const v = item[k]
          if (typeof v === 'string' && v.trim()) out[k] = v.trim()
        }
        return out
      }
      return item
    }

    function RulesSettings(props) {
      const [snapshot, setSnapshot] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [feedback, setFeedback] = React.useState(null)
      const [newKeyword, setNewKeyword] = React.useState('')
      const [newRule, setNewRule] = React.useState({ tool: '', mode: '', category: '', contains: '' })
      const [threshold, setThreshold] = React.useState('3')
      const [timeoutMs, setTimeoutMs] = React.useState('20000')
      const [dataDirInput, setDataDirInput] = React.useState('')
      // 两段式行内确认（替代 window.confirm）：Electron renderer 的原生 confirm
      // 关闭后常导致输入焦点丢失（点不动输入框，需切窗恢复）。第一次点按钮 →
      // 按钮变「确认添加？」并 3 秒内再点才提交，超时自动回退。
      const [pendingConfirm, setPendingConfirm] = React.useState(null) // 'denyKeyword' | 'allowRule' | null
      const confirmTimerRef = React.useRef(null)
      const armConfirm = function (kind) {
        setPendingConfirm(kind)
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = setTimeout(function () { setPendingConfirm(null) }, 3000)
      }
      const disarmConfirm = function () {
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        setPendingConfirm(null)
      }
      React.useEffect(function () {
        return function () { if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current) }
      }, [])

      const load = function () {
        fetch('/api/auto-approve/rules', { headers: { 'cache-control': 'no-cache' } })
          .then(function (r) { return r.json() })
          .then(function (data) {
            if (data && data.config) {
              setSnapshot(data)
              setThreshold(String(data.config.riskyThreshold))
              setTimeoutMs(String(data.config.judgeTimeoutMs))
              setDataDirInput(data.config.dataDir || '')
              setError(null)
            } else {
              setError('加载规则失败：' + JSON.stringify(data).slice(0, 200))
            }
          })
          .catch(function (e) { setError('加载规则失败：' + String((e && e.message) || e)) })
      }
      React.useEffect(function () { load() }, [])

      const showFeedback = function (msg, ok) {
        setFeedback({ msg: String(msg), ok: ok !== false })
        setTimeout(function () { setFeedback(null) }, 4000)
      }

      // POST /rules：ok → 刷新快照；非 ok（400/403）→ 反馈条展示服务端 error 原文（含 forbidden 级 403）
      const api = function (body, okMsg) {
        setBusy(true)
        return fetch('/api/auto-approve/rules', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then(function (r) { return r.json() }).then(function (res) {
          if (res && res.ok) { load(); showFeedback(okMsg || '已生效（热更新，无需重启）'); return res }
          showFeedback((res && res.error) || '操作失败', false)
          return res
        }).catch(function (e) {
          showFeedback('请求失败：' + String((e && e.message) || e), false)
        }).finally(function () { setBusy(false) })
      }

      // 黑名单添加（confirm 级）：两段式行内确认（无原生模态框，避免 Electron 焦点丢失）
      const submitNewKeyword = function () {
        const kw = newKeyword.trim()
        if (!kw || busy) return
        if (pendingConfirm !== 'denyKeyword') { armConfirm('denyKeyword'); return }
        disarmConfirm()
        // 注：正则危险清单在插件加载时编译，关键词变更需重启 dsh web 完全生效
        api({ op: 'add', kind: 'denyKeywords', value: kw }, '已生效（黑名单正则层需重启 dsh web 完全生效）')
        setNewKeyword('')
      }

      // 白名单添加（confirm 级）：用户手输 danger-full-access → 前端先拦截提示（不发请求，服务端也会 403）；
      // 其余走两段式行内确认
      const submitNewRule = function () {
        if (busy) return
        const value = { tool: newRule.tool, mode: newRule.mode, category: newRule.category, contains: newRule.contains }
        if (!value.tool && !value.mode && !value.category && !value.contains) return
        if (String(value.mode || '').trim().toLowerCase() === 'danger-full-access') {
          showFeedback('danger-full-access 不可通过 UI 加入白名单（请求未发送；如确需配置请编辑 allowlist.json）', false)
          return
        }
        if (pendingConfirm !== 'allowRule') { armConfirm('allowRule'); return }
        disarmConfirm()
        api({ op: 'add', kind: 'allowRules', value: value })
        setNewRule({ tool: '', mode: '', category: '', contains: '' })
      }

      // 数据目录（confirm 级，启动期字段）：两段式行内确认；服务端校验绝对路径，重启后生效
      const submitDataDir = function () {
        const value = dataDirInput.trim()
        if (!value || busy) return
        if (pendingConfirm !== 'dataDir') { armConfirm('dataDir'); return }
        disarmConfirm()
        api({ op: 'set', kind: 'dataDir', value: value }, '已保存，重启 DSH Desktop 后生效')
      }

      if (!snapshot) {
        return React.createElement('div', { className: 'ag-set' },
          React.createElement('div', { className: error ? 'ag-set-err' : 'ag-set-ok' }, error || '加载中…'))
      }

      const cfg = snapshot.config
      const perm = snapshot.permission || {}
      const predefined = snapshot.predefined || {}
      const preDeny = new Set((predefined.denyKeywords || []).map(function (s) { return String(s).trim() }))
      const preAllow = new Set((predefined.allowRules || []).map(function (r) { return JSON.stringify(normalizeRule(r)) }))
      const preHard = new Set(predefined.hardCategories || [])
      const learnStats = snapshot.learning && snapshot.learning.stats ? snapshot.learning.stats : {}
      const learnHistory = snapshot.learning && snapshot.learning.history ? snapshot.learning.history : {}
      const statKeys = Object.keys(learnStats)
      // 删除黑名单词（confirm 级）：两段式确认（键=条目值），预置项按钮已 disabled（服务端 403 兜底）
      const removeKeyword = function (kw) {
        const key = 'delKw:' + kw
        if (pendingConfirm !== key) { armConfirm(key); return }
        disarmConfirm()
        api({ op: 'remove', kind: 'denyKeywords', value: kw }, '已生效（黑名单正则层需重启 dsh web 完全生效）')
      }

      return React.createElement('div', { className: 'ag-set' },
        React.createElement('h3', { className: 'ag-set-title' }, '自动审批'),
        React.createElement('p', { className: 'ag-set-intro' },
          '管理自动审批的放行与阻塞规则：查看判定管道、硬风险类别（只读）、黑/白名单与学习进度，修改即时生效（热更新）。' +
          '各配置项按四级权限渲染：只读项无操作控件，确认项操作前弹框，预置项不可删除。'),

        // ---- 管道总览 / 硬风险类别（forbidden 级：只读网格，无增删控件） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' },
                perm.hardCategories === 'forbidden' ? 'forbidden · 只读' : '只读'),
              '硬风险类别 · 永久人工'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '每次沙箱越界按下述链路判定：硬风险类别命中直接转人工（不计数、不学习、永不自动放行）。' +
              '安全边界不可通过 UI 修改，如需调整请编辑 allowlist.json。')),
          React.createElement('div', { className: 'ag-set-grid' },
            (cfg.hardCategories || []).map(function (c) {
              const isPre = preHard.has(c)
              return React.createElement('span', { className: 'ag-set-hc', key: c },
                c + (isPre ? '' : ' · 自定义'))
            })),
        ),

        // ---- 黑名单（denyKeywords，confirm 级：add 确认框 / 预置项删除禁用） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '① DENY 层'),
              '黑名单 · 不可逆危险词'),
            React.createElement('p', { className: 'ag-set-card-sub' }, '管道第一步：命中即转人工（fail-safe，最高优先）。可添加自定义危险词；预置词不可删除。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('input', {
              className: 'ag-set-input', value: newKeyword, placeholder: '输入危险词，如 sudo rm',
              onChange: function (e) { setNewKeyword(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') submitNewKeyword() },
            }),
            React.createElement('button', {
              type: 'button',
              className: 'ag-set-btn' + (pendingConfirm === 'denyKeyword' ? ' ag-set-btn-confirm' : ''),
              disabled: busy || !newKeyword.trim(),
              onClick: submitNewKeyword,
            }, pendingConfirm === 'denyKeyword' ? '确认添加？' : '添加'),
          ),
          (cfg.denyKeywords || []).length === 0
            ? React.createElement('div', { className: 'ag-set-empty' }, '无黑名单词')
            : React.createElement('div', { className: 'ag-set-list' },
                cfg.denyKeywords.map(function (kw) {
                  const isPre = preDeny.has(String(kw).trim())
                  return React.createElement('div', { className: 'ag-set-item', key: kw },
                    React.createElement('span', { className: 'ag-set-item-label' }, kw),
                    isPre ? React.createElement('span', { className: 'ag-set-item-meta' }, '预置') : null,
                    React.createElement('button', {
                      type: 'button',
                      className: 'ag-set-item-del' + (pendingConfirm === 'delKw:' + kw ? ' ag-set-item-del-confirm' : ''),
                      disabled: isPre,
                      title: isPre ? '预置项不可删除' : (pendingConfirm === 'delKw:' + kw ? '再点一次确认删除' : '删除'),
                      'aria-label': '删除 ' + kw,
                      onClick: function () { if (!isPre) removeKeyword(kw) },
                    }, pendingConfirm === 'delKw:' + kw ? '确认?' : '✕'),
                  )
                }),
              ),
        ),

        // ---- 白名单（allowRules，confirm 级：add 确认框 + danger-full-access 前端拦截 / 预置项删除禁用） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '② 白名单层'),
              '白名单 · 自动放行规则'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '管道第二步：命中规则直接自动放行（不过 Flash）。示例：tool=edit → edit 类操作自动放行。' +
              'danger-full-access 不可通过 UI 加入白名单。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('input', { className: 'ag-set-input', style: { width: 110 }, placeholder: 'tool', value: newRule.tool, onChange: function (e) { setNewRule(Object.assign({}, newRule, { tool: e.target.value })) } }),
            React.createElement('input', { className: 'ag-set-input', style: { width: 210 }, placeholder: 'mode（可选：workspace-write 等）', value: newRule.mode, onChange: function (e) { setNewRule(Object.assign({}, newRule, { mode: e.target.value })) } }),
            React.createElement('input', { className: 'ag-set-input', style: { width: 110 }, placeholder: 'category（可选）', value: newRule.category, onChange: function (e) { setNewRule(Object.assign({}, newRule, { category: e.target.value })) } }),
            React.createElement('input', { className: 'ag-set-input', style: { width: 130 }, placeholder: 'contains（可选）', value: newRule.contains, onChange: function (e) { setNewRule(Object.assign({}, newRule, { contains: e.target.value })) } }),
            React.createElement('button', {
              type: 'button',
              className: 'ag-set-btn ag-set-btn-primary' + (pendingConfirm === 'allowRule' ? ' ag-set-btn-confirm' : ''),
              disabled: busy || !(newRule.tool || newRule.mode || newRule.category || newRule.contains),
              onClick: submitNewRule,
            }, pendingConfirm === 'allowRule' ? '确认添加？' : '添加'),
          ),
          (cfg.allowRules || []).length === 0
            ? React.createElement('div', { className: 'ag-set-empty' }, '无白名单规则')
            : React.createElement('div', { className: 'ag-set-list' },
                cfg.allowRules.map(function (rule, idx) {
                  const parts = []
                  if (rule.tool) parts.push('tool=' + rule.tool)
                  if (rule.mode) parts.push('mode=' + rule.mode)
                  if (rule.category) parts.push('category=' + rule.category)
                  if (rule.contains) parts.push('contains=' + rule.contains)
                  const label = parts.join('  ') || '(任意)'
                  const src = ruleSource(rule)
                  // 预置判定：剥 description 比四键（normalizeRule 与服务端 normalizeItem 同构）
                  const isPre = preAllow.has(JSON.stringify(normalizeRule(rule)))
                  return React.createElement('div', { className: 'ag-set-item', key: idx },
                    React.createElement('span', { className: 'ag-set-item-label' }, label),
                    rule.description ? React.createElement('span', { className: 'ag-set-item-meta' }, rule.description) : null,
                    RULE_SOURCE_TAGS[src] || RULE_SOURCE_TAGS.default,
                    React.createElement('button', {
                      type: 'button', className: 'ag-set-item-del',
                      disabled: isPre,
                      title: isPre ? '预置项不可删除' : '删除规则',
                      'aria-label': '删除规则',
                      onClick: function () {
                        if (isPre) return
                        api({ op: 'remove', kind: 'allowRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains } })
                      },
                    }, '✕'),
                  )
                }),
              ),
        ),

        // ---- 永久人工（denyRules，confirm 级） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '③ denyRules 层'),
              '永久人工 · 拒绝升级规则'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '管道第三步：neutral 操作被你拒绝后自动升级到这里，命中直接转人工（永不自动放行）。硬风险类别本身永久人工，不在此记录。可手动移除。')),
          (cfg.denyRules || []).length === 0
            ? React.createElement('div', { className: 'ag-set-empty' }, '无升级规则（硬风险类别本就永久人工，不在此记录）')
            : React.createElement('div', { className: 'ag-set-list' },
                cfg.denyRules.map(function (rule, idx) {
                  const parts = []
                  if (rule.tool) parts.push('tool=' + rule.tool)
                  if (rule.mode) parts.push('mode=' + rule.mode)
                  if (rule.category) parts.push('category=' + rule.category)
                  if (rule.contains) parts.push('contains=' + rule.contains)
                  return React.createElement('div', { className: 'ag-set-item', key: idx },
                    React.createElement('span', { className: 'ag-set-item-label' }, parts.join('  ') || '(任意)'),
                    React.createElement('button', {
                      type: 'button', className: 'ag-set-item-del', title: '移除', 'aria-label': '移除规则',
                      onClick: function () {
                        api({ op: 'remove', kind: 'denyRules', value: { tool: rule.tool, mode: rule.mode, category: rule.category, contains: rule.contains } })
                      },
                    }, '✕'),
                  )
                }),
              ),
        ),

        // ---- 阈值 / 超时（④ Flash 判定参数，free 级：直接保存，min/max 与服务端校验一致） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '④ Flash 判定'),
              '阈值与超时'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '管道第四步：确认阈值 N（学习满 N 次后第 N+1 次自动放行）与 Flash 判断超时（超时自动重试 1 次，仍失败转人工）。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('span', { className: 'ag-set-item-meta' }, '确认阈值 N（1-20）：'),
            React.createElement('input', {
              className: 'ag-set-input ag-set-input-num', type: 'number', min: 1, max: 20, value: threshold,
              onChange: function (e) { setThreshold(e.target.value) },
            }),
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn', disabled: busy,
              onClick: function () { api({ op: 'set', kind: 'riskyThreshold', value: Number(threshold) }) },
            }, '保存'),
            React.createElement('span', { className: 'ag-set-item-meta' }, '满 ' + Number(threshold) + ' 次后第 ' + (Number(threshold) + 1) + ' 次起自动'),
          ),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('span', { className: 'ag-set-item-meta' }, 'Flash 判断超时(ms)（5000-120000）：'),
            React.createElement('input', {
              className: 'ag-set-input ag-set-input-num', type: 'number', min: 5000, max: 120000, value: timeoutMs,
              onChange: function (e) { setTimeoutMs(e.target.value) },
            }),
            React.createElement('button', {
              type: 'button', className: 'ag-set-btn', disabled: busy,
              onClick: function () { api({ op: 'set', kind: 'judgeTimeoutMs', value: Number(timeoutMs) }) },
            }, '保存'),
          ),
        ),

        // ---- 学习进度（只读展示；服务端未开放 learning kind，不提供单项终止） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, '⑤ 学习沉淀'),
              '学习进度（只读）'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '中立操作人工确认制：同一「工具|模式|类别」每确认一次计数 +1，确认满 ' + cfg.riskyThreshold + ' 次后，第 ' + (cfg.riskyThreshold + 1) + ' 次起自动放行并沉淀规则。' +
              '此处仅展示进度，不提供单项终止（如需清空学习，使用会话命令 /approval-core-clear-learning）。')),
          statKeys.length === 0
            ? React.createElement('div', { className: 'ag-set-empty' }, '暂无正在学习的内容')
            : React.createElement('div', { className: 'ag-set-learn' },
                statKeys.map(function (k) {
                  const samples = (learnHistory[k] || []).map(function (s) { return (s && (s.fp || s.ctx)) || '' }).join(' / ').slice(0, 160)
                  return React.createElement('div', { className: 'ag-set-learn-item', key: k },
                    React.createElement('div', { className: 'ag-set-learn-info' },
                      React.createElement('span', { className: 'ag-set-learn-key' }, k),
                      React.createElement('span', { className: 'ag-set-learn-sub' },
                        '已确认 ' + learnStats[k] + '/' + cfg.riskyThreshold + (samples ? ' · ' + samples : '')),
                      React.createElement('span', { className: 'ag-set-learn-sub' },
                        '如需清空学习，使用会话命令 /approval-core-clear-learning'),
                    ),
                  )
                }),
              ),
        ),

        // ---- 数据目录（confirm 级，可编辑：改后需重启生效）与分类模型（只读信息卡） ----
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' },
              React.createElement('span', { className: 'ag-set-stage' }, 'confirm · 重启生效'),
              '数据目录与分类模型'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '数据目录是启动期字段：声明快照/事件/审计/学习数据的存放目录，修改保存后需重启 DSH Desktop 生效。')),
          React.createElement('div', { className: 'ag-set-row' },
            React.createElement('span', { className: 'ag-set-item-meta' }, '数据目录：'),
            React.createElement('input', {
              className: 'ag-set-input', style: { width: 320 },
              placeholder: '如 D:\\data\\dsh-approval（绝对路径）',
              value: dataDirInput,
              onChange: function (e) { setDataDirInput(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Enter') submitDataDir() },
            }),
            React.createElement('button', {
              type: 'button',
              className: 'ag-set-btn' + (pendingConfirm === 'dataDir' ? ' ag-set-btn-confirm' : ''),
              disabled: busy || !dataDirInput.trim(),
              onClick: submitDataDir,
            }, pendingConfirm === 'dataDir' ? '确认保存？' : '保存'),
          ),
          React.createElement('p', { className: 'ag-set-card-sub' },
            '分类模型：' + (cfg.classifierModel || '会话默认模型（未单独配置）') +
            '（只读，如需修改请编辑数据目录下的 allowlist.json）')),

        // ---- 反馈 ----
        feedback
          ? React.createElement('div', { className: feedback.ok ? 'ag-set-ok' : 'ag-set-err' }, feedback.msg)
          : null,
      )
    }

    const plugin = {
      inject: ['timer'],
      async apply(ctx) {
        const slots = ctx.get('slots')
        if (slots === undefined) return

        let styleEl = null
        try {
          styleEl = document.createElement('style')
          styleEl.setAttribute('data-plugin-css', 'dsh-approval-core')
          styleEl.textContent = CSS
          document.head.appendChild(styleEl)
        } catch (e) {
          console.error('[dsh-approval-core] 注入样式失败：' + String((e && e.message) || e))
        }
        ctx.effect(() => {
          return () => {
            if (styleEl && styleEl.parentNode) {
              try { styleEl.parentNode.removeChild(styleEl) } catch (e) {}
            }
          }
        })

        // ✅ 自动放行提示条：输入框上方独立行（order=30，排在 todo/goal/queue 之下，天然不重叠）
        slots.inject('conversation.input.dock', function () {
          return slots.register(
            { name: 'conversation.input.dock', id: 'dsh-approval-core.notice', order: 30, label: '自动放行提示' },
            function (props) { return React.createElement(NoticeStrip, { slotsProps: props }) },
          )
        })

        // 审批历史视图：conversation.view（order=20，位于轨迹 order=10 右侧）
        slots.inject('conversation.view', function () {
          return slots.register(
            {
              name: 'conversation.view',
              id: 'dsh-approval-core.history',
              order: 20,
              label: '审批',
              inject: (sessionId) => ({ sessionId }),
            },
            function (props) { return React.createElement(HistoryView, { slotsProps: props }) },
          )
        })

        // 设置页：自动审批规则管理（settings.section，分级渲染）
        slots.inject('settings.section', function () {
          return slots.register(
            { name: 'settings.section', id: 'dsh-approval-core.settings', order: 60, label: '自动审批' },
            function (props) { return React.createElement(RulesSettings, { slotsProps: props }) },
          )
        })
      },
    }

    exports.default = plugin
    exports.apply = plugin.apply
    exports.inject = plugin.inject
    return module.exports
  },
})
