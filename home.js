/* ============================================================
   首页（Landing / Home）脚本 —— 与 site/index.html 配合使用
   UI 编号索引：
   UI-04 导航胶囊（Game/Work/Video 点击平滑滚动到第 33/73/119 帧）
   UI-04b Gooey Nav 动画（液体胶囊融合 + 果冻抖动 + 点击粒子，React Bits 移植）
   UI-10 Stats 计数动画（easeOutCubic，加载后按节奏触发一次）
   UI-11 移动端汉堡菜单（开合 / Escape / 遮罩点击 / 链接点击关闭）
   ============================================================ */
(function () {
  "use strict";

  /* ---- UI-04 导航帧跳转：data-frame 属性 → 滚动条位置反解 ----
     帧号 N 对应滚动进度 p = (N-1)/(TOTAL-1)，
     scrollY = p * (轨道高度 - 视口高度)，与 index.html 内联脚本的帧公式一致 */
  const TOTAL = 119;
  document.querySelectorAll("[data-frame]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const track = document.getElementById("track");
      const max = track.offsetHeight - window.innerHeight;
      const f = Math.min(Number(link.dataset.frame), TOTAL);
      window.scrollTo({ top: ((f - 1) / (TOTAL - 1)) * max, behavior: "smooth" });
    });
  });

  /* ---- UI-10 Stats 计数动画 ---- */
  const stats = [
    { target: 4000, suffix: "", decimals: 0 },
    { target: 33, suffix: "", decimals: 0 },
    { target: 5, suffix: "", decimals: 0 },
    { target: 13, suffix: "", decimals: 0 }
  ];
  const values = document.querySelectorAll('[data-ui="10"] .stat-value');
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function runCount(el, cfg, i) {
    const duration = 1500 + i * 80;
    const start = performance.now() + 480 + i * 90;
    function frame(now) {
      const t = Math.min(Math.max((now - start) / duration, 0), 1);
      const v = cfg.target * easeOutCubic(t);
      el.textContent = v.toFixed(cfg.decimals) + cfg.suffix;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (values.length) {
    /* 统计位于首屏、加载即可见：直接按原延迟节奏触发计数
       （IntersectionObserver 在无焦点的内嵌预览窗口里不派发通知，故不采用） */
    values.forEach((el, i) => {
      el.textContent = "0" + stats[i].suffix;
      runCount(el, stats[i], i);
    });
  }

  /* ---- UI-05 我的简历：跳转简历页（桌面按钮 + 移动端菜单按钮） ---- */
  document.querySelectorAll(".sign-in").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = "resume.html";
    });
  });

  /* ---- UI-11 移动端汉堡菜单 ---- */
  const burger = document.querySelector('[data-ui="11"].burger');
  const menu = document.getElementById("mobileMenu");
  if (burger && menu) {
    const setOpen = (open) => {
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      menu.hidden = !open;
      document.body.classList.toggle("menu-open", open);
    };
    burger.addEventListener("click", () => {
      setOpen(burger.getAttribute("aria-expanded") !== "true");
    });
    menu.addEventListener("click", (e) => {
      if (e.target === menu || e.target.closest("a, .sign-in")) setOpen(false);
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 720) setOpen(false);
    });
  }

  /* ---- UI-04b 导航 Gooey Nav 动画（React Bits 官方组件移植）----
     常驻胶囊滑向点击项，悬停胶囊从指针下长出；两层胶囊经 SVG goo 滤镜
     （高斯模糊 + alpha 提对比）融合成液体，切换瞬间用 feDisplacementMap
     抖出果冻感，点击再洒一把粒子。胶囊只做视觉层，链接本体不动 */
  const nav = document.querySelector(".nav-pill");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (nav && !reducedMotion) {
    const links = Array.from(nav.querySelectorAll("a"));
    const goo = nav.querySelector(".nav-gooey");
    const activeBlob = nav.querySelector(".nav-blob-active");
    const hoverBlob = nav.querySelector(".nav-blob-hover");
    const canvas = nav.querySelector(".nav-particles");
    const warpMap = document.getElementById("gooeyNavWarpMap");
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let activeIdx = Math.max(0, links.findIndex((a) => a.classList.contains("active")));
    let warpRaf = 0;

    const rectInNav = (el) => {
      const r = el.getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      return { x: r.left - n.left, y: r.top - n.top, w: r.width, h: r.height };
    };
    const placeByTransform = (blob, rc) => {
      blob.style.width = rc.w + "px";
      blob.style.height = rc.h + "px";
      blob.style.transform = "translate(" + rc.x + "px," + rc.y + "px)";
    };
    const placeByInset = (blob, rc) => {
      blob.style.left = rc.x + "px";
      blob.style.top = rc.y + "px";
      blob.style.width = rc.w + "px";
      blob.style.height = rc.h + "px";
    };

    function setActive(i, animate) {
      activeIdx = i;
      links.forEach((a, k) => a.classList.toggle("active", k === i));
      if (!animate) goo.classList.add("no-anim");
      placeByTransform(activeBlob, rectInNav(links[i]));
      if (!animate) {
        void goo.offsetWidth; // 跳位后恢复过渡
        goo.classList.remove("no-anim");
      }
      goo.classList.add("is-ready");
    }

    /* 果冻抖动：切换/悬停瞬间把位移强度 0→60→0 扫一遍 */
    function wobble() {
      if (!warpMap) return;
      cancelAnimationFrame(warpRaf);
      const t0 = performance.now(), dur = 480, max = 60;
      const step = (now) => {
        const t = Math.min((now - t0) / dur, 1);
        warpMap.setAttribute("scale", (Math.sin(t * Math.PI) * max).toFixed(1));
        if (t < 1) warpRaf = requestAnimationFrame(step);
      };
      warpRaf = requestAnimationFrame(step);
    }

    /* 粒子迸溅（点击项时从点击点向外抛洒） */
    const ctx2d = canvas.getContext("2d");
    const COLORS = ["#4da3ff", "#a855f7", "#635bff", "#ffffff"];
    let particles = [], partRaf = 0;
    function sizeCanvas() {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * DPR);
      canvas.height = Math.round(r.height * DPR);
    }
    function burst(e) {
      const r = canvas.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      for (let i = 0; i < 12; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 26 + Math.random() * 56;
        particles.push({
          x: cx, y: cy,
          vx: Math.cos(ang) * dist, vy: Math.sin(ang) * dist - 14,
          r: 1.6 + Math.random() * 2.8,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          born: performance.now(), life: 480 + Math.random() * 240
        });
      }
      cancelAnimationFrame(partRaf);
      const step = (now) => {
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
        particles = particles.filter((p) => now - p.born < p.life);
        if (!particles.length) return;
        for (const p of particles) {
          const t = (now - p.born) / p.life;
          const e2 = 1 - Math.pow(1 - t, 3);
          const px = (p.x + p.vx * e2) * DPR;
          const py = (p.y + p.vy * e2 + 26 * t * t) * DPR;
          ctx2d.globalAlpha = 1 - t;
          ctx2d.fillStyle = p.color;
          ctx2d.beginPath();
          ctx2d.arc(px, py, p.r * DPR * (1 - t * 0.4), 0, Math.PI * 2);
          ctx2d.fill();
        }
        ctx2d.globalAlpha = 1;
        partRaf = requestAnimationFrame(step);
      };
      partRaf = requestAnimationFrame(step);
    }

    links.forEach((a, i) => {
      a.addEventListener("pointerenter", () => {
        if (i === activeIdx) { hoverBlob.classList.remove("is-on"); return; }
        placeByInset(hoverBlob, rectInNav(a));
        hoverBlob.classList.add("is-on");
        wobble();
      });
      a.addEventListener("click", (e) => {
        if (i !== activeIdx) { setActive(i, true); wobble(); }
        if (!a.dataset.frame) {
          e.preventDefault();           // Home：回顶部（Game/Work/Video 由 data-frame 处理器滚动）
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        if (!reducedMotion) burst(e);
      });
    });
    nav.addEventListener("pointerleave", () => hoverBlob.classList.remove("is-on"));

    setActive(activeIdx, false);
    sizeCanvas();
    window.addEventListener("resize", () => {
      goo.classList.add("no-anim");
      setActive(activeIdx, false);
      goo.classList.remove("no-anim");
      sizeCanvas();
    });
    /* 字体加载完成后链接宽度会变，校正一次胶囊位置 */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => setActive(activeIdx, false));
    }
  }
})();
