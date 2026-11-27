(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const scene = window.starlitScene;
  const help = $('camera-help');
  const panel = $('camera-panel');
  const toggle = $('camera-toggle');
  const video = $('webcam');
  const cursors = [...document.querySelectorAll('.hand-cursor')];
  const error = $('camera-error');
  const status = $('camera-status');
  let stream, model, modelPromise, cameraFrame, session = 0;
  let running = false, lastDetect = 0, lastVideoTime = -1;
  const shapes = { 1: 'tree', 2: 'sky', 3: 'wreath', 4: 'heart', open: 'sky', fist: 'tree' };
  const gestureLabels = { 1: '1 指 · 圣诞树', 2: '2 指 · 星海', 3: '3 指 · 花环', 4: '4 指 · 爱心', open: '张掌 · 星海', fist: '握拳 · 圣诞树' };
  let tracks = [null, null], lastCommand = null, zoomGesture = null, suppressOpen = false;

  function statusText(text) {
    if (status.textContent !== text) status.textContent = text;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  }

  function classifyHand(landmarks, wasPinching, aspect) {
    if (!landmarks || landmarks.length !== 21 || landmarks.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
    const points = landmarks.map(p => ({ x: p.x * aspect, y: p.y, z: (p.z || 0) * aspect }));
    const wrist = points[0], thumbJoint = points[3], thumbTip = points[4], indexBase = points[5], pinkyBase = points[17];
    const span = distance(indexBase, pinkyBase);
    const palm = Math.max(.025, (distance(wrist, points[9]) + span) / 2);
    const extended = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]].map(([m, p, t]) => {
      const [base, joint, tip] = [points[m], points[p], points[t]];
      const a = [base.x - joint.x, base.y - joint.y, (base.z || 0) - (joint.z || 0)];
      const b = [tip.x - joint.x, tip.y - joint.y, (tip.z || 0) - (joint.z || 0)];
      const alignment = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
      return alignment < -.45 && distance(tip, wrist) > distance(joint, wrist) * 1.06;
    });
    const count = extended.filter(Boolean).length;
    const thumbOutside = ((thumbTip.x - indexBase.x) * (indexBase.x - pinkyBase.x) +
      (thumbTip.y - indexBase.y) * (indexBase.y - pinkyBase.y) +
      (thumbTip.z - indexBase.z) * (indexBase.z - pinkyBase.z)) / (span * span || 1);
    const thumbOpen = thumbOutside > .17 && distance(thumbTip, indexBase) > .58 * palm &&
      distance(thumbTip, wrist) > distance(thumbJoint, wrist) * 1.045;
    const pinching = distance(thumbTip, points[8]) / palm < (wasPinching ? .45 : .30) &&
      (extended.slice(1).filter(Boolean).length >= 2 || distance(points[8], wrist) > palm * 1.44);
    const mid = [landmarks[0], landmarks[5], landmarks[9], landmarks[17]];
    return {
      gesture: pinching ? 'pinch' : count === 4 && thumbOpen ? 'open' : count === 0 && thumbOpen ? null : count || 'fist',
      x: 1 - mid.reduce((sum, p) => sum + p.x, 0) / 4,
      y: mid.reduce((sum, p) => sum + p.y, 0) / 4,
      sx: 1 - (pinching ? (landmarks[8].x + landmarks[4].x) / 2 : landmarks[8].x),
      sy: pinching ? (landmarks[8].y + landmarks[4].y) / 2 : landmarks[8].y
    };
  }

  function resetHand() {
    tracks = [null, null];
    lastCommand = null;
    zoomGesture = null;
    suppressOpen = false;
    panel.dataset.hands = '0';
    cursors.forEach(cursor => { cursor.hidden = true; });
    scene.track(false);
  }

  function stop() {
    session++;
    running = false;
    cancelAnimationFrame(cameraFrame);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.pause();
    video.srcObject = null;
    lastVideoTime = -1;
    resetHand();
    panel.hidden = true;
    toggle.innerHTML = '<span aria-hidden="true">◉</span> 开启手势';
    toggle.setAttribute('aria-pressed', 'false');
  }

  function updateCameraVisibility() {
    if (!stream) return;
    const paused = document.hidden;
    stream.getVideoTracks().forEach(track => { track.enabled = !paused; });
    cancelAnimationFrame(cameraFrame);
    lastVideoTime = -1;
    if (paused) {
      resetHand();
      statusText('切回页面后继续识别');
    } else if (running) {
      statusText('把一只手或双手放进镜头');
      cameraFrame = requestAnimationFrame(detect);
    }
  }

  async function createModel() {
    const root = new URL('vision/', location.href);
    const { FilesetResolver, HandLandmarker } = await import(new URL('vision_bundle.mjs', root).href);
    const files = await FilesetResolver.forVisionTasks(new URL('wasm', root).href);
    const options = {
      baseOptions: { modelAssetPath: new URL('hand_landmarker.task', root).href, delegate: 'GPU' },
      runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: .5,
      minHandPresenceConfidence: .5, minTrackingConfidence: .55
    };
    try { return await HandLandmarker.createFromOptions(files, options); }
    catch {
      options.baseOptions.delegate = 'CPU';
      return HandLandmarker.createFromOptions(files, options);
    }
  }

  function loadModel() {
    if (modelPromise) return modelPromise;
    modelPromise = new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(new DOMException('Gesture model timed out', 'TimeoutError'));
      }, 45000);
      createModel().then(loaded => {
        clearTimeout(timer);
        if (expired) loaded.close();
        else resolve(loaded);
      }, cause => { clearTimeout(timer); reject(cause); });
    }).catch(cause => { modelPromise = null; throw cause; });
    return modelPromise;
  }

  function cameraError(cause) {
    return {
      NotAllowedError: '请在浏览器的网站设置中允许摄像头访问，然后重试。',
      NotFoundError: '没有找到可用的摄像头。',
      NotReadableError: '摄像头无法读取。请关闭正在占用摄像头的应用，然后重试。',
      TimeoutError: '手势模型加载超时，请重试。'
    }[cause.name] || '手势资源未能加载。请确认 vision 文件夹完整，并使用最新版 Safari 或 Chrome。';
  }

  async function start() {
    if (!window.isSecureContext || location.protocol === 'file:' || !navigator.mediaDevices?.getUserMedia) {
      error.textContent = '请双击 start.cmd 启动本地网页，或通过 HTTPS 访问后开启摄像头。';
      return;
    }
    const ticket = ++session;
    help.close();
    panel.hidden = false;
    toggle.innerHTML = '<span aria-hidden="true">◉</span> 关闭手势';
    toggle.setAttribute('aria-pressed', 'true');
    statusText('等待摄像头授权…');
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } } });
      if (ticket !== session) { input.getTracks().forEach(track => track.stop()); return; }
      stream = input;
      const track = stream.getVideoTracks()[0];
      track?.addEventListener('ended', () => { if (ticket === session) { stop(); scene.toast('摄像头已关闭'); } });
      if (document.hidden) updateCameraVisibility();
      video.srcObject = stream;
      await video.play();
      if (ticket !== session) return;
      statusText('正在载入手势识别…');
      const loaded = await loadModel();
      if (ticket !== session) return;
      model = loaded;
      running = true;
      updateCameraVisibility();
    } catch (cause) {
      if (ticket !== session) return;
      stop();
      error.textContent = cameraError(cause);
      if (!help.open) help.showModal();
    }
  }

  function advanceTrack(hand, previous, index, now) {
    const cursor = cursors[index];
    const isPinch = hand.gesture === 'pinch';
    const sameGesture = previous?.hand.gesture === hand.gesture;
    const x = Math.max(12, Math.min(innerWidth - 12, hand.sx * innerWidth));
    const y = Math.max(12, Math.min(innerHeight - 12, hand.sy * innerHeight));
    const point = previous && sameGesture ? {
      x: previous.point.x + (x - previous.point.x) * .48,
      y: previous.point.y + (y - previous.point.y) * .48
    } : { x, y };
    cursor.hidden = scene.photoOpen();
    cursor.style.left = `${point.x}px`;
    cursor.style.top = `${point.y}px`;
    cursor.classList.toggle('pinching', isPinch);
    const target = isPinch && !scene.photoOpen() ? scene.nearestPhoto(point.x, point.y, Math.min(42, innerWidth * .075)) : null;
    return { hand, point, target, since: sameGesture && previous ? previous.since : now,
      targetSince: sameGesture && previous?.target === target ? previous.targetSince : now,
      spent: sameGesture && !!previous?.spent,
      dx: previous ? hand.x - previous.hand.x : 0, dy: previous ? hand.y - previous.hand.y : 0 };
  }

  function matchCost(hand, previous) {
    if (!previous) return .32;
    const old = previous.hand;
    const handPenalty = hand.label && old.label && hand.label !== old.label ? .12 : 0;
    return Math.hypot(hand.x - old.x, hand.y - old.y) + handPenalty;
  }

  function applyZoom(hands, aspect, now) {
    if (hands.length !== 2 || scene.photoOpen()) { zoomGesture = null; return false; }
    if (!hands.every(track => track.hand.gesture === 'open')) {
      if (zoomGesture && now - zoomGesture.seenAt < 175) return true;
      zoomGesture = null;
      return false;
    }
    const [a, b] = hands.map(track => track.hand);
    const gap = Math.max(.10, Math.hypot(a.x - b.x, (a.y - b.y) / aspect));
    if (!zoomGesture) zoomGesture = { anchor: gap, filtered: gap, level: scene.zoomLevel(), seenAt: now };
    const state = zoomGesture;
    state.seenAt = now;
    suppressOpen = true;
    if (Math.abs(gap - state.filtered) > .0025) {
      state.filtered += (gap - state.filtered) * .46;
      const desired = state.level * (state.filtered / state.anchor) ** .86;
      const applied = scene.setZoom(desired);
      if (Math.abs(desired - applied) > .001) {
        state.anchor = state.filtered;
        state.level = applied;
      }
    }
    statusText('双手 · 拉开放大，合拢缩小');
    return true;
  }

  function applyHands(result, now) {
    const aspect = video.videoWidth / video.videoHeight || 1;
    const detections = result.landmarks.slice(0, 2).map((points, index) => {
      const hand = classifyHand(points, false, aspect);
      if (!hand) return null;
      hand.label = result.handedness?.[index]?.[0]?.categoryName || '';
      return { hand, points };
    }).filter(Boolean);
    if (!detections.length) {
      resetHand();
      statusText('把一只手或双手放进镜头');
      return;
    }
    const first = detections[0].hand;
    const second = detections[1]?.hand;
    const direct = matchCost(first, tracks[0]) + (second ? matchCost(second, tracks[1]) : 0);
    const crossed = matchCost(first, tracks[1]) + (second ? matchCost(second, tracks[0]) : 0);
    if (crossed < direct) detections.unshift(second ? detections.pop() : null);
    tracks = cursors.map((cursor, index) => {
      const detection = detections[index];
      if (!detection) { cursor.hidden = true; return null; }
      const old = matchCost(detection.hand, tracks[index]) < .44 ? tracks[index] : null;
      const hand = old?.hand.gesture === 'pinch' ?
        { ...classifyHand(detection.points, true, aspect), label: detection.hand.label } : detection.hand;
      return advanceTrack(hand, old, index, now);
    });
    const visible = tracks.filter(Boolean);
    const pinches = visible.filter(track => track.hand.gesture === 'pinch');
    const prefix = visible.length === 2 ? '双手 · ' : '单手 · ';
    panel.dataset.hands = String(visible.length);
    scene.track(true, pinches.map(track => track.target).filter(Boolean));
    if (pinches.length) {
      zoomGesture = null;
      lastCommand = null;
      if (scene.photoOpen()) { statusText(prefix + '张开手掌退出照片'); return; }
      const ready = pinches.find(track => track.target && !track.spent && now - track.targetSince > 380);
      if (ready) {
        pinches.forEach(track => { track.spent = true; });
        scene.openPhoto(ready.target);
      }
      statusText(prefix + (pinches.some(track => track.target) ? '捏合停留打开照片' : '把光标移到光球上'));
      return;
    }

    if (applyZoom(visible, aspect, now)) return;
    if (!visible.some(track => track.hand.gesture === 'open')) suppressOpen = false;

    if (!scene.photoOpen()) {
      scene.turn(visible.reduce((sum, track) => sum + track.dx, 0) / visible.length,
        visible.reduce((sum, track) => sum + track.dy, 0) / visible.length);
    }
    const stable = visible.filter(track => {
      const gesture = track.hand.gesture;
      if (gesture === 'open' && suppressOpen && !scene.photoOpen()) return false;
      return gesture && now - track.since > 235 && (!scene.photoOpen() || gesture === 'open' || gesture === 'fist');
    });
    const numbers = stable.filter(track => typeof track.hand.gesture === 'number');
    const candidates = numbers.length ? numbers : stable;
    candidates.sort((a, b) => b.since - a.since);
    const [chosen, other] = candidates;
    if (!chosen) { lastCommand = null; statusText(prefix + '保持手势或移动旋转'); return; }
    if (other && chosen.hand.gesture !== other.hand.gesture && chosen.since - other.since < 140) {
      statusText(prefix + '保持同一手势或用一只手切换');
      return;
    }
    const gesture = chosen.hand.gesture;
    if (gesture !== lastCommand) {
      lastCommand = gesture;
      if (gesture === 'open' || gesture === 'fist') { if (scene.photoOpen()) scene.closePhoto(); }
      if (!scene.photoOpen() || gesture === 'open' || gesture === 'fist') scene.setMode(shapes[gesture]);
    }
    statusText(prefix + gestureLabels[gesture]);
  }

  function detect(now) {
    if (!running || document.hidden) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetect > 62) {
      lastDetect = now;
      lastVideoTime = video.currentTime;
      try {
        const result = model.detectForVideo(video, now);
        applyHands(result, now);
      } catch { stop(); scene.toast('手势识别中断，请重新开启'); return; }
    }
    cameraFrame = requestAnimationFrame(detect);
  }

  toggle.onclick = () => {
    if (!panel.hidden) { stop(); return; }
    error.textContent = '';
    help.showModal();
  };
  $('cancel-camera').onclick = () => help.close();
  $('start-camera').onclick = start;
  $('stop-camera').onclick = stop;
  document.addEventListener('visibilitychange', updateCameraVisibility);
  window.addEventListener('pagehide', stop);
})();
