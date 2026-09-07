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
.ag-set-list{flex-direction:column;gap:6px;display:flex}
.ag-set-item{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:8px;align-items:center;gap:8px;padding:6px 10px;min-width:0;display:flex}
.ag-set-item-label{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;font-family:var(--ds-font-family-code);word-break:break-all}
.ag-set-item-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;white-space:nowrap}
.ag-set-item-del{flex:none;width:24px;height:24px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:none;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;padding:0}
.ag-set-item-del:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
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
.ag-diff-line-add{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-label-primary)}
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
.ag-file-chip-snap{cursor:pointer;border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}
.ag-file-chip-snap:hover{background:var(--dsw-alias-interactive-bg-hover)}
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
              React.createElement('span', null, '文件改动对比'),
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

      // 清除快照：mode='session' 仅本会话（默认），mode='all' 清全部（含其他会话，需二次确认）
      const doClearSnapshots = function (mode) {
        const sid = mode === 'session' ? sessionId : ''
        const msg = mode === 'all'
          ? '确定清除【全部会话】的 diff 快照？这可能删除其他会话还没看过的改动对比记录，且不可恢复。'
          : '确定清除【本会话】的 diff 快照？仅删除本会话审批产生的改动对比数据，不影响审批记录本身。'
        if (!window.confirm(msg)) return
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

      return React.createElement('div', { className: 'ag-view' },
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
            className: 'ag-set-btn',
            onClick: function () { doClearSnapshots('session') },
            disabled: !snapStats || snapStats.count === 0,
            title: '仅清除本会话的 diff 快照（不影响其他会话）',
          }, '仅清本会话'),
          React.createElement('button', {
            type: 'button',
            className: 'ag-set-btn ag-set-btn-danger',
            onClick: function () { doClearSnapshots('all') },
            disabled: !snapStats || snapStats.count === 0,
            title: '清空全部会话（含其他会话未查看过的）diff 快照，需二次确认',
          }, '清空全部'),
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
                  const hasSnap = snapIds !== null && snapIds.has(String(ev.id))
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
                                chipProps.onClick = function () { setDiffOpen({ eventId: ev.id, path: f }) }
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

    // ================= 设置页：自动审批说明（settings.section） =================
    // v1 安全加固：不提供任何 HTTP 规则修改入口（/api/auto-approve/rules 与 /setup 已摘除）。
    // 规则/阈值/超时/学习开关一律直接编辑 $DSH_HOME/auto-approve/allowlist.json 后生效
    // （审批前热读盘）；权限预设直接在 profile 的 cordis.patch.yml 中配置。
    function RulesSettings() {
      return React.createElement('div', { className: 'ag-set' },
        React.createElement('h3', { className: 'ag-set-title' }, '自动审批'),
        React.createElement('p', { className: 'ag-set-intro' },
          '自动审批的放行与阻塞规则 v1 不提供页面配置入口。请直接编辑配置文件：'),
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' }, '规则配置文件'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '编辑 $DSH_HOME/auto-approve/allowlist.json 可配置 denyKeywords / allowRules / denyRules / hardCategories / riskyThreshold / judgeTimeoutMs / learning。' +
              '保存后自动生效（每次审批前热读盘，无需重启）；其中 denyKeywords 的正则危险清单在插件加载时编译，变更需重启 dsh web。')),
        ),
        React.createElement('div', { className: 'ag-set-card' },
          React.createElement('div', { className: 'ag-set-card-head' },
            React.createElement('div', { className: 'ag-set-card-title' }, '权限预设'),
            React.createElement('p', { className: 'ag-set-card-sub' },
              '启用自动审批需在 profile 的 cordis.patch.yml 中添加 auto-approve 权限预设（预设表在配置构造时冻结，无法自动扩展）。')),
        ),
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

        // 设置页：自动审批说明（settings.section；v1 无规则修改 API）
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
