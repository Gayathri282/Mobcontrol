/* ==========================================================================
   Mob Control - 3D Visual Crowd Engine & Game Logic
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Canvas Setup & Responsive Scaling ---------- */
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');
  var glCanvas = document.getElementById('glCanvas');

  var W = 400, H = 700, scale = 1, offY = 0, dpr = 1;
  var crowdY;

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var vw = rect.width || window.innerWidth;
    var vh = rect.height || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    H = Math.max(520, Math.min(1000, Math.round(W * vh / vw)));

    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    scale = (vw * dpr) / W;
    offY = (vh * dpr - H * scale) / 2;
    crowdY = H * 0.76;

    if (renderer3D && camera3D) {
      renderer3D.setSize(vw, vh);
      renderer3D.setPixelRatio(dpr);
      camera3D.aspect = vw / vh;
      camera3D.updateProjectionMatrix();
    }
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () {
    setTimeout(resize, 120);
  });

  /* ---------- Web Audio BGM & Sound Effects Synthesizer ---------- */
  var actx = null, masterGain = null, bgmGain = null;
  var bgmTimer = null, bgmIndex = 0;

  function initAudio() {
    if (!actx) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        masterGain = actx.createGain();
        masterGain.gain.value = 0.50;
        masterGain.connect(actx.destination);

        bgmGain = actx.createGain();
        bgmGain.gain.value = 0.16;
        bgmGain.connect(masterGain);
      } catch (e) {
        actx = null;
      }
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function tone(o) {
    if (!actx) return;
    var t0 = actx.currentTime + (o.delay || 0);
    var osc = actx.createOscillator(), g = actx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.from, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.15, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.03);
  }

  function noise(dur, vol, freq, q, type) {
    if (!actx) return;
    var n = Math.floor(actx.sampleRate * dur);
    var buf = actx.createBuffer(1, n, actx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = actx.createBufferSource();
    src.buffer = buf;
    var f = actx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq || 900;
    f.Q.value = q || 1;
    var g = actx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(masterGain);
    src.start();
  }

  var BGM_NOTES = [
    261.63, 329.63, 392.00, 523.25, 392.00, 329.63,
    293.66, 349.23, 440.00, 587.33, 440.00, 349.23,
    329.63, 392.00, 493.88, 659.25, 493.88, 392.00,
    349.23, 440.00, 523.25, 698.46, 523.25, 440.00
  ];

  function playBGMStep() {
    if (!actx || state !== STATE_PLAY) return;
    try {
      var note = BGM_NOTES[bgmIndex % BGM_NOTES.length];
      bgmIndex++;

      var osc = actx.createOscillator();
      var g = actx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = note;

      g.gain.setValueAtTime(0.0001, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, actx.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.18);

      osc.connect(g);
      g.connect(bgmGain);

      osc.start();
      osc.stop(actx.currentTime + 0.19);
    } catch (e) {}
  }

  function startBGM() {
    if (bgmTimer) clearInterval(bgmTimer);
    bgmIndex = 0;
    bgmTimer = setInterval(playBGMStep, 210);
  }

  function stopBGM() {
    if (bgmTimer) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }
  }

  var sfx = {
    gain: function () {
      tone({ from: 580, to: 1050, dur: 0.14, type: 'sine', vol: 0.16 });
      tone({ from: 1050, to: 1450, dur: 0.12, type: 'triangle', vol: 0.10, delay: 0.04 });
    },
    levelUp: function () {
      var notes = [523.25, 659.25, 783.99, 1046.50, 1318.51];
      for (var i = 0; i < notes.length; i++) {
        tone({ from: notes[i], dur: 0.22, type: 'triangle', vol: 0.15, delay: i * 0.07 });
      }
    },
    lose: function () {
      tone({ from: 380, to: 180, dur: 0.18, type: 'sawtooth', vol: 0.08 });
      noise(0.08, 0.04, 500, 1.2);
    },
    toll: function () {
      tone({ from: 300, dur: 0.1, type: 'square', vol: 0.1 });
      tone({ from: 450, dur: 0.16, type: 'square', vol: 0.1, delay: 0.08 });
    },
    gameOver: function () {
      var melody = [440, 415, 392, 349];
      for (var i = 0; i < melody.length; i++) {
        tone({ from: melody[i], to: melody[i] * 0.94, dur: 0.28, type: 'sawtooth', vol: 0.12, delay: i * 0.12 });
      }
    },
    crash: function () {
      noise(0.3, 0.14, 380, 0.6);
      tone({ from: 280, to: 70, dur: 0.5, type: 'sawtooth', vol: 0.12 });
    }
  };

  /* ---------- Helpers ---------- */
  function shade(hex, amt) {
    var r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    function c(v) {
      return Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
    }
    return 'rgb(' + c(r) + ',' + c(g) + ',' + c(b) + ')';
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }

  /* ---------- Game State Variables ---------- */
  var STATE_TITLE = 0, STATE_PLAY = 1, STATE_OVER = 2;
  var state = STATE_TITLE;

  var crowd, crowdX, vx, dots, particles, popups;
  var obstacles, distance, score, best = 0, peak, shake, alive, tclock;
  var pointerActive = false, tx = 0, kInput = 0;
  var milestoneNext;
  var touchDir = 0;
  var currentLevel = 1, levelToast = { text: '', subtext: '', life: 0, scale: 0 };

  try {
    best = parseInt(localStorage.getItem('mob_best') || '0', 10) || 0;
  } catch (e) {}

  var POS_OPS = [
    { op: '+', mk: function () { return randInt(3, 8); }, color: '#4caf50' },
    { op: 'x', mk: function () { return Math.random() < 0.75 ? 2 : 3; }, color: '#2196f3' }
  ];
  var NEG_OPS = [
    { op: '-', mk: function () { return randInt(4, 12); }, color: '#ff3344' },
    { op: '/', mk: function () { return 2; }, color: '#ff3344' }
  ];

  function applyOp(count, seg) {
    if (seg.op === '+') return count + seg.val;
    if (seg.op === '-') return count - seg.val;
    if (seg.op === 'x') return count * seg.val;
    if (seg.op === '/') return Math.floor(count / seg.val);
    return count;
  }

  function makeGate(y) {
    var probNeg = Math.min(0.60, 0.20 + distance / 3500);
    var isMoving = distance > 600 && Math.random() < 0.35;
    var segs = [];

    // Determine preview character count N (2, 3, or 4)
    var leftCount = distance > 1500 ? (Math.random() < 0.4 ? 4 : (Math.random() < 0.6 ? 3 : 2)) : (Math.random() < 0.35 ? 3 : 2);
    var rightCount = distance > 1500 ? (Math.random() < 0.4 ? 4 : (Math.random() < 0.6 ? 3 : 2)) : (Math.random() < 0.35 ? 3 : 2);

    var leftNeg = Math.random() < probNeg;
    var rightNeg = (!leftNeg && Math.random() < probNeg) || (leftNeg && Math.random() < 0.4);

    if (leftNeg && rightNeg) {
      if (Math.random() < 0.5) leftNeg = false;
      else rightNeg = false;
    }

    // 2 preview players -> x2; 3 preview players -> x3; 2 preview villains -> /2; 3 preview villains -> /3
    var leftSeg = {
      x0: 12,
      x1: W / 2 - 32,
      op: leftNeg ? '/' : 'x',
      val: leftCount,
      unitCount: leftCount,
      color: leftNeg ? '#ff3344' : '#2196f3',
      neg: leftNeg
    };

    var rightSeg = {
      x0: W / 2 + 32,
      x1: W - 12,
      op: rightNeg ? '/' : 'x',
      val: rightCount,
      unitCount: rightCount,
      color: rightNeg ? '#ff3344' : '#2196f3',
      neg: rightNeg
    };

    segs.push(leftSeg, rightSeg);

    return {
      type: 'gate',
      id: Math.random().toString(36).substring(2),
      y: y,
      segs: segs,
      centerGapX0: W / 2 - 32,
      centerGapX1: W / 2 + 32,
      resolved: false,
      isMoving: isMoving,
      moveOffset: 0,
      moveDir: Math.random() < 0.5 ? 1 : -1
    };
  }

  function makeToll(y) {
    var req = 10 + Math.floor(distance / 200) + randInt(0, 8);
    return { type: 'toll', id: Math.random().toString(36).substring(2), y: y, req: req, resolved: false };
  }

  function getHighestObstacleY() {
    if (obstacles.length === 0) return 9999;
    var minY = 9999;
    for (var i = 0; i < obstacles.length; i++) {
      if (obstacles[i].y < minY) minY = obstacles[i].y;
    }
    return minY;
  }

  function spawnObstacleAt(y) {
    if (distance > 450 && Math.random() < 0.30) obstacles.push(makeToll(y));
    else obstacles.push(makeGate(y));
  }

  /* ---------- THREE.JS 3D ENGINE & FBX VISUAL CROWD SYSTEM ---------- */
  var renderer3D, scene3D, camera3D;
  var masterPlayerModel = null;
  var masterVillainModel = null;
  var masterObstacleModel = null;
  var proceduralPlayerModel = null;
  var proceduralVillainModel = null;
  var heroAnimClips = {};
  var villainAnimClips = {};
  var fbxLoaded = false;
  var mob3DInstances = [];
  var villain3DInstances = [];
  var gate3DPreviewInstances = {};
  var obstacle3DInstances = {};
  var jumpTimer = 0;
  var wallHitTimer = 0;

  function init3D() {
    if (typeof THREE === 'undefined') return;

    var vw = glCanvas.clientWidth || window.innerWidth;
    var vh = glCanvas.clientHeight || window.innerHeight;

    renderer3D = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
    renderer3D.setSize(vw, vh);
    renderer3D.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer3D.shadowMap.enabled = true;
    renderer3D.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding) renderer3D.outputEncoding = THREE.sRGBEncoding;

    scene3D = new THREE.Scene();
    scene3D.background = new THREE.Color(0x000000);
    scene3D.fog = new THREE.FogExp2(0x000000, 0.012);

    camera3D = new THREE.PerspectiveCamera(45, vw / vh, 0.1, 300);
    camera3D.position.set(0, 16, 22);
    camera3D.lookAt(0, 1.5, -6);

    // Lights
    var ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene3D.add(ambientLight);

    var dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
    dirLight.position.set(15, 35, 20);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 100;
    var d = 25;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene3D.add(dirLight);

    var hemiLight = new THREE.HemisphereLight(0xffffff, 0x111111, 0.6);
    scene3D.add(hemiLight);

    // 3D Track Environment (Black Road)
    var trackGeo = new THREE.PlaneGeometry(22, 400);
    var trackMat = new THREE.MeshStandardMaterial({
      color: 0x050505,
      roughness: 0.5,
      metalness: 0.2
    });
    var trackMesh = new THREE.Mesh(trackGeo, trackMat);
    trackMesh.rotation.x = -Math.PI / 2;
    trackMesh.position.set(0, -0.01, -150);
    trackMesh.receiveShadow = true;
    scene3D.add(trackMesh);

    // Track Borders / Sleek Metallic Rails
    var borderGeo = new THREE.BoxGeometry(0.6, 0.8, 400);
    var borderMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x111111, roughness: 0.4 });
    
    var leftBorder = new THREE.Mesh(borderGeo, borderMat);
    leftBorder.position.set(-11, 0.4, -150);
    scene3D.add(leftBorder);

    var rightBorder = new THREE.Mesh(borderGeo, borderMat);
    rightBorder.position.set(11, 0.4, -150);
    scene3D.add(rightBorder);

    proceduralPlayerModel = createProceduralPlayerModel();
    proceduralVillainModel = createProceduralVillainModel();

    loadFBXAssets();
  }

  var rawAnimClips = {};

  function cleanBoneName(name) {
    if (!name) return "";
    return name
      .replace(/^.*?:/g, '')
      .replace(/^.*?(mixamorig\d*|mixamorig\d*\_?)/i, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  }

  function retargetClipToModel(clip, targetModel) {
    if (!clip || !clip.tracks || !targetModel) return clip;

    var retargeted = clip.clone();
    var newTracks = [];

    var targetBoneMap = {};
    targetModel.traverse(function (child) {
      if (child.isBone || child.type === 'Bone') {
        var full = child.name;
        var clean = cleanBoneName(full);
        if (clean) targetBoneMap[clean] = full;
        targetBoneMap[full.toLowerCase()] = full;
      }
    });

    for (var i = 0; i < clip.tracks.length; i++) {
      var track = clip.tracks[i].clone();
      var parts = track.name.split('.');
      var rawBoneName = parts[0];
      var property = parts[1] ? '.' + parts[1] : '';

      var cleanTrackBone = cleanBoneName(rawBoneName);
      var matchedBone = targetBoneMap[cleanTrackBone] || targetBoneMap[rawBoneName.toLowerCase()];
      if (matchedBone) {
        track.name = matchedBone + property;

        // Root motion removal: lock Z & X position drift on root/hips bones so character runs smoothly in-place
        if (property === '.position' && (cleanTrackBone === 'hips' || cleanTrackBone.indexOf('root') !== -1)) {
          var newVals = new Float32Array(track.values.length);
          var initX = track.values[0];
          var initZ = track.values[2];
          for (var vIdx = 0; vIdx < track.values.length; vIdx += 3) {
            newVals[vIdx] = initX;                         // Lock lateral drift
            newVals[vIdx + 1] = track.values[vIdx + 1];   // Keep natural vertical bounce
            newVals[vIdx + 2] = initZ;                       // Lock Z forward root translation
          }
          track.values = newVals;
        }

        newTracks.push(track);
      } else {
        newTracks.push(track);
      }
    }

    retargeted.tracks = newTracks;
    return retargeted;
  }

  function attachMixerToInstance(inst, isVillain) {
    if (!inst || !inst.mesh) return;
    var clipSet = isVillain ? villainAnimClips : heroAnimClips;
    if (Object.keys(clipSet).length === 0) return;

    if (!inst.mixer) {
      inst.mixer = new THREE.AnimationMixer(inst.mesh);
    }
    inst.actions = {};
    for (var animName in clipSet) {
      var clip = clipSet[animName];
      var action = inst.mixer.clipAction(clip);
      action.loop = THREE.LoopRepeat;
      inst.actions[animName] = action;
    }
    // Fallback left & right turns to running animation if specific turn clips aren't separate
    if (!inst.actions['left'] && inst.actions['run']) inst.actions['left'] = inst.actions['run'];
    if (!inst.actions['right'] && inst.actions['run']) inst.actions['right'] = inst.actions['run'];

    var cur = inst.currentAction || ((state === STATE_TITLE) ? 'idle' : (state === STATE_OVER ? 'fall' : 'run'));
    if (inst.actions[cur]) {
      inst.actions[cur].play();
    } else if (inst.actions['run']) {
      inst.actions['run'].play();
    }
  }

  function finalizeRetargeting() {
    for (var animName in rawAnimClips) {
      var rawClip = rawAnimClips[animName];
      if (masterPlayerModel) {
        heroAnimClips[animName] = retargetClipToModel(rawClip, masterPlayerModel);
      }
      if (masterVillainModel) {
        villainAnimClips[animName] = retargetClipToModel(rawClip, masterVillainModel);
      }
    }

    // Retroactively attach mixers and actions to all currently active 3D character instances!
    for (var i = 0; i < mob3DInstances.length; i++) {
      attachMixerToInstance(mob3DInstances[i], false);
    }
    for (var v = 0; v < villain3DInstances.length; v++) {
      attachMixerToInstance(villain3DInstances[v], true);
    }
  }

  function loadFBXResilient(loader, primaryPath, onSuccess, onError) {
    loader.load(primaryPath, onSuccess, undefined, function (err) {
      var altPath = primaryPath.indexOf('asset/') === 0 ? primaryPath.replace('asset/', 'assets/') : (primaryPath.indexOf('assets/') === 0 ? primaryPath.replace('assets/', 'asset/') : primaryPath);
      if (altPath !== primaryPath) {
        loader.load(altPath, onSuccess, undefined, function (err2) {
          if (onError) onError(err2 || err);
        });
      } else if (onError) {
        onError(err);
      }
    });
  }

  function loadFBXAssets() {
    if (typeof THREE.FBXLoader === 'undefined') return;

    var loader = new THREE.FBXLoader();
    var loadedCount = 0;
    var totalToLoad = 7;

    function checkComplete() {
      loadedCount++;
      if (loadedCount >= totalToLoad) {
        finalizeRetargeting();
        fbxLoaded = true;
      }
    }

    function applyFBXMaterial(child) {
      child.castShadow = true;
      child.receiveShadow = true;
      var prepMat = function (m) {
        if (!m) return m;
        m.skinning = true;
        m.side = THREE.DoubleSide;
        m.needsUpdate = true;
        return m;
      };
      if (Array.isArray(child.material)) {
        child.material = child.material.map(prepMat);
      } else if (child.material) {
        child.material = prepMat(child.material);
      }
    }

    // 1. Load Hero Player Model
    loadFBXResilient(loader, 'asset/player/Ch09_nonPBR.fbx', function (object) {
      object.traverse(function (child) {
        if (child.isMesh) {
          applyFBXMaterial(child);
        }
      });
      object.scale.setScalar(0.012);
      masterPlayerModel = object;
      fbxLoaded = true;
      refreshMob3DModels();
      checkComplete();
    }, function (err) {
      console.error("FBX hero model loading error:", err);
      checkComplete();
    });

    // 2. Load 3D Villain Model
    loadFBXResilient(loader, 'asset/villain/Warzombie F Pedroso.fbx', function (object) {
      object.traverse(function (child) {
        if (child.isMesh) {
          applyFBXMaterial(child);
        }
      });
      object.scale.setScalar(0.025);
      masterVillainModel = object;
      checkComplete();
    }, function (err) {
      console.error("FBX villain model loading error:", err);
      checkComplete();
    });

    // 3. Load 3D Obstacle Model (Barbwire Enemy Outpost)
    loadFBXResilient(loader, 'asset/obstacles/Barb+wire.fbx', function (object) {
      object.traverse(function (child) {
        if (child.isLight) {
          child.intensity = 0;
          child.visible = false;
        }
        if (child.isCamera) {
          child.visible = false;
        }
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.material = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.8,
            roughness: 0.25,
            side: THREE.DoubleSide
          });
        }
      });
      object.scale.setScalar(0.012);
      masterObstacleModel = object;
      checkComplete();
    }, function (err) {
      console.error("FBX obstacle model loading error:", err);
      checkComplete();
    });

    // 4. Load Movement Animations
    var animFiles = [
      { name: 'run', path: 'asset/movements/running.fbx' },
      { name: 'idle', path: 'asset/movements/idle.fbx' },
      { name: 'jump', path: 'asset/movements/jumping up.fbx' },
      { name: 'fall', path: 'asset/movements/falling idle.fbx' }
    ];

    animFiles.forEach(function (anim) {
      loadFBXResilient(loader, anim.path, function (animObj) {
        if (animObj.animations && animObj.animations.length > 0) {
          var clip = animObj.animations[0];
          clip.name = anim.name;
          rawAnimClips[anim.name] = clip;
        }
        checkComplete();
      }, function (err) {
        console.error("FBX animation load error (" + anim.name + "):", err);
        checkComplete();
      });
    });
  }

  function createProceduralPlayerModel() {
    var group = new THREE.Group();

    var bodyGeo = new THREE.CylinderGeometry(0.35, 0.35, 1.2, 12);
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0x4cd97b, roughness: 0.3, metalness: 0.1 });
    var body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    var headGeo = new THREE.SphereGeometry(0.38, 16, 16);
    var headMat = new THREE.MeshStandardMaterial({ color: 0x4cd97b, roughness: 0.3, metalness: 0.1 });
    var head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.4;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    return group;
  }

  function createProceduralVillainModel() {
    var group = new THREE.Group();

    var bodyGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.5, 12);
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0xee2244, roughness: 0.4, metalness: 0.2 });
    var body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.75;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    var headGeo = new THREE.SphereGeometry(0.48, 16, 16);
    var headMat = new THREE.MeshStandardMaterial({ color: 0xee2244, roughness: 0.4, metalness: 0.2 });
    var head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.7;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    return group;
  }

  function refreshMob3DModels() {
    for (var i = 0; i < mob3DInstances.length; i++) {
      if (mob3DInstances[i].mesh) scene3D.remove(mob3DInstances[i].mesh);
    }
    mob3DInstances = [];
  }

  function create3DMobMember(index) {
    var modelTemplate = masterPlayerModel || proceduralPlayerModel;
    if (!modelTemplate) return null;

    var cloneMesh;
    if (THREE.SkeletonUtils && THREE.SkeletonUtils.clone && masterPlayerModel) {
      cloneMesh = THREE.SkeletonUtils.clone(modelTemplate);
    } else {
      cloneMesh = modelTemplate.clone(true);
    }

    scene3D.add(cloneMesh);

    var member = {
      mesh: cloneMesh,
      mixer: null,
      actions: {},
      currentAction: (state === STATE_TITLE) ? 'idle' : (state === STATE_OVER ? 'fall' : 'run'),
      slotIndex: index || 0,
      jitterX: (Math.random() - 0.5) * 0.4,
      jitterZ: (Math.random() - 0.5) * 0.4,
      speedMult: 0.95 + Math.random() * 0.1
    };

    if (masterPlayerModel) {
      attachMixerToInstance(member, false);
    }

    return member;
  }

  function spawnVillainArmyWave(count, startX3D, startZ3D) {
    var modelVillain = masterVillainModel || proceduralVillainModel;
    if (!modelVillain) return;

    var numVillains = Math.min(25, Math.max(2, Math.round(count)));
    for (var i = 0; i < numVillains; i++) {
      var cloneMesh;
      if (THREE.SkeletonUtils && THREE.SkeletonUtils.clone && masterVillainModel) {
        cloneMesh = THREE.SkeletonUtils.clone(modelVillain);
      } else {
        cloneMesh = modelVillain.clone(true);
      }

      var ox = (Math.random() - 0.5) * 6;
      var oz = (Math.random() - 0.5) * 4;

      cloneMesh.position.set(startX3D + ox, 0, startZ3D + oz);
      cloneMesh.rotation.y = 0; // Face towards hero army (+Z direction)
      scene3D.add(cloneMesh);

      var vil = {
        mesh: cloneMesh,
        mixer: null,
        actions: {},
        currentAction: 'run',
        speed: 12 + Math.random() * 6,
        alive: true
      };

      if (masterVillainModel) {
        attachMixerToInstance(vil, true);
      }

      villain3DInstances.push(vil);
    }
  }

  function update3DGatePreviews(dt) {
    var modelPlayer = masterPlayerModel || proceduralPlayerModel;
    var modelVillain = masterVillainModel || proceduralVillainModel;
    if (!modelPlayer || !modelVillain) return;

    var activeIds = {};

    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.type !== 'gate' || o.resolved) continue;

      var z3D = (o.y - crowdY) * 0.046;
      if (z3D < -180 || z3D > 30) continue;

      activeIds[o.id] = true;

      if (!gate3DPreviewInstances[o.id]) {
        var previews = [];
        var ox = o.moveOffset || 0;

        for (var sIdx = 0; sIdx < o.segs.length; sIdx++) {
          var seg = o.segs[sIdx];
          var segCenterX3D = ((seg.x0 + seg.x1) / 2 + ox - W / 2) * 0.046;
          var masterObj = seg.neg ? modelVillain : modelPlayer;
          var countToRender = seg.unitCount || seg.val || 2;

          for (var p = 0; p < countToRender; p++) {
            var mesh = (THREE.SkeletonUtils && THREE.SkeletonUtils.clone && (seg.neg ? masterVillainModel : masterPlayerModel)) ? THREE.SkeletonUtils.clone(masterObj) : masterObj.clone(true);
            var itemObj = {
              mesh: mesh,
              mixer: null,
              actions: {},
              currentAction: 'run',
              segIndex: sIdx,
              pIndex: p,
              totalUnits: countToRender,
              isNeg: seg.neg
            };

            attachMixerToInstance(itemObj, seg.neg);

            var pOffset = (p - (countToRender - 1) / 2) * 1.1;
            var pX = segCenterX3D + pOffset;
            mesh.position.set(pX, 0, z3D);
            mesh.rotation.y = 0;
            scene3D.add(mesh);

            previews.push(itemObj);
          }
        }
        gate3DPreviewInstances[o.id] = previews;
      } else {
        var list = gate3DPreviewInstances[o.id];
        var moveOx = o.moveOffset || 0;
        for (var k = 0; k < list.length; k++) {
          var item = list[k];
          var segItem = o.segs[item.segIndex];
          if (segItem) {
            var segCenterX = ((segItem.x0 + segItem.x1) / 2 + moveOx - W / 2) * 0.046;
            var tot = item.totalUnits || 2;
            var pOffsetMove = (item.pIndex - (tot - 1) / 2) * 1.1;
            item.mesh.position.x = segCenterX + pOffsetMove;
          }
          item.mesh.position.z = z3D;
          if (item.mixer) item.mixer.update(dt);
        }
      }
    }

    for (var id in gate3DPreviewInstances) {
      if (!activeIds[id]) {
        var items = gate3DPreviewInstances[id];
        for (var m = 0; m < items.length; m++) {
          scene3D.remove(items[m].mesh);
        }
        delete gate3DPreviewInstances[id];
      }
    }

    var activeObstacleIds = {};
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.type !== 'toll' || o.resolved) continue;

      var z3D = (o.y - crowdY) * 0.046;
      if (z3D < -180 || z3D > 30) continue;

      activeObstacleIds[o.id] = true;

      if (!obstacle3DInstances[o.id]) {
        var meshes = [];
        if (masterObstacleModel) {
          for (var b = -2; b <= 2; b++) {
            var mesh = masterObstacleModel.clone(true);
            mesh.position.set(b * 3.6, 0, z3D);
            scene3D.add(mesh);
            meshes.push(mesh);
          }
        }
        obstacle3DInstances[o.id] = meshes;
      } else {
        var list = obstacle3DInstances[o.id];
        for (var k = 0; k < list.length; k++) {
          list[k].position.z = z3D;
        }
      }
    }

    for (var oId in obstacle3DInstances) {
      if (!activeObstacleIds[oId]) {
        var items = obstacle3DInstances[oId];
        for (var m = 0; m < items.length; m++) {
          scene3D.remove(items[m]);
        }
        delete obstacle3DInstances[oId];
      }
    }
  }

  function setInstanceAnimation(inst, animName, fadeTime) {
    if (!inst || !inst.actions) return;
    fadeTime = fadeTime || 0.18;

    var prevAction = inst.actions[inst.currentAction];
    var nextAction = inst.actions[animName];

    // If next action is missing or identical to current active action, return to prevent loop resets
    if (!nextAction || prevAction === nextAction) {
      if (nextAction) inst.currentAction = animName;
      return;
    }

    if (prevAction) prevAction.fadeOut(fadeTime);
    nextAction.reset().fadeIn(fadeTime).play();
    inst.currentAction = animName;
  }

  /* Update 3D Hero Mob & Organic Formation Spread */
  function update3DMob(dt) {
    var modelTemplate = masterPlayerModel || proceduralPlayerModel;
    if (!modelTemplate) return;

    var targetCount = Math.min(100, Math.max(1, Math.round(crowd)));

    while (mob3DInstances.length < targetCount) {
      var idx = mob3DInstances.length;
      var member = create3DMobMember(idx);
      if (member) mob3DInstances.push(member);
      else break;
    }

    while (mob3DInstances.length > targetCount) {
      var removed = mob3DInstances.pop();
      if (removed && removed.mesh) {
        scene3D.remove(removed.mesh);
      }
    }

    var desiredAnim = 'run';
    var jumpArcY = 0;

    if (state === STATE_TITLE) {
      desiredAnim = 'idle';
    } else if (state === STATE_OVER || !alive) {
      desiredAnim = 'fall';
    } else if (jumpTimer > 0) {
      if (jumpTimer > 0.35) {
        desiredAnim = 'jump';
      } else {
        desiredAnim = 'fall';
      }
      jumpArcY = Math.sin(Math.max(0, jumpTimer / 0.65) * Math.PI) * 2.2;
    } else {
      var steer = kInput || touchDir;
      if (steer < -0.2 || vx < -40) desiredAnim = 'left';
      else if (steer > 0.2 || vx > 40) desiredAnim = 'right';
      else desiredAnim = 'run';
    }

    var centerX3D = (crowdX - W / 2) * 0.046;

    var cols = Math.min(10, Math.max(3, Math.ceil(Math.sqrt(targetCount * 1.4))));
    var spacingX = Math.min(1.3, 6.0 / cols);
    var spacingZ = 1.05;

    for (var i = 0; i < mob3DInstances.length; i++) {
      var inst = mob3DInstances[i];
      setInstanceAnimation(inst, desiredAnim);

      var row = Math.floor(i / cols);
      var col = i % cols;

      var slotX = (col - (cols - 1) / 2) * spacingX + inst.jitterX;
      var slotZ = -row * spacingZ + inst.jitterZ;

      var targetX = centerX3D + slotX;
      var targetZ = slotZ;

      inst.mesh.position.x += (targetX - inst.mesh.position.x) * Math.min(1, dt * 14);
      inst.mesh.position.z += (targetZ - inst.mesh.position.z) * Math.min(1, dt * 14);
      inst.mesh.position.y += (jumpArcY - inst.mesh.position.y) * Math.min(1, dt * 12);

      var targetRotY = Math.PI;
      var targetRollZ = 0;
      if (desiredAnim === 'left') { targetRotY = Math.PI - 0.28; targetRollZ = 0.08; }
      else if (desiredAnim === 'right') { targetRotY = Math.PI + 0.28; targetRollZ = -0.08; }

      inst.mesh.rotation.y += (targetRotY - inst.mesh.rotation.y) * Math.min(1, dt * 12);
      inst.mesh.rotation.z += (targetRollZ - inst.mesh.rotation.z) * Math.min(1, dt * 12);

      var levelAnimSpeed = 1 + (currentLevel - 1) * 0.18 + Math.min(1.0, distance * 0.0003);
      if (inst.mixer) inst.mixer.update(dt * inst.speedMult * levelAnimSpeed);
    }

    update3DGatePreviews(dt);

    if (state === STATE_PLAY) {
      for (var v = villain3DInstances.length - 1; v >= 0; v--) {
        var vil = villain3DInstances[v];
        if (!vil.alive) {
          scene3D.remove(vil.mesh);
          villain3DInstances.splice(v, 1);
          continue;
        }

        var vilSpeedMult = 1 + (currentLevel - 1) * 0.16;
        vil.mesh.position.z += vil.speed * vilSpeedMult * dt;
        if (vil.mixer) vil.mixer.update(dt * vilSpeedMult);

        // Check 1-to-1 contact clash against individual player mob 3D instances
        var hitPlayerIndex = -1;
        for (var pIdx = 0; pIdx < mob3DInstances.length; pIdx++) {
          var playerInst = mob3DInstances[pIdx];
          var dx = vil.mesh.position.x - playerInst.mesh.position.x;
          var dz = vil.mesh.position.z - playerInst.mesh.position.z;
          if (dx * dx + dz * dz < 3.2) { // Contact distance threshold
            hitPlayerIndex = pIdx;
            break;
          }
        }

        if (hitPlayerIndex !== -1) {
          // Defeat villain
          vil.alive = false;
          scene3D.remove(vil.mesh);

          // Defeat & remove the specific 3D player mesh hit by villain
          var hitPlayer = mob3DInstances[hitPlayerIndex];
          if (hitPlayer && hitPlayer.mesh) {
            scene3D.remove(hitPlayer.mesh);
          }
          mob3DInstances.splice(hitPlayerIndex, 1);

          // Battle clash particle burst at exact contact point
          var clashCanvasX = (vil.mesh.position.x / 0.046) + W / 2;
          var clashCanvasY = crowdY + (vil.mesh.position.z * 18);
          burst(clashCanvasX, clashCanvasY, 14, '255,60,60', 35, 3.8);
          sfx.lose();

          // Decrement crowd count 1-to-1
          crowd = Math.max(0, crowd - 1);
          if (crowd <= 0) {
            crash();
            return;
          }
        } else if (vil.mesh.position.z > 20) {
          scene3D.remove(vil.mesh);
          villain3DInstances.splice(v, 1);
        }
      }
    }

    camera3D.position.x += (centerX3D * 0.45 - camera3D.position.x) * Math.min(1, dt * 5);
  }

  /* ---------- Reset Game ---------- */
  function reset() {
    crowd = 6; crowdX = W / 2 - 70; vx = 0;
    obstacles = []; particles = []; popups = []; dots = [];
    distance = 0; score = 0; peak = crowd; shake = 0; alive = true; tclock = 0;
    milestoneNext = 500; currentLevel = 1; levelToast = { text: '', subtext: '', life: 0, scale: 0 };
    tx = crowdX; pointerActive = false; kInput = 0; touchDir = 0; jumpTimer = 0;

    for (var i = 0; i < mob3DInstances.length; i++) {
      if (mob3DInstances[i].mesh) scene3D.remove(mob3DInstances[i].mesh);
    }
    mob3DInstances = [];

    for (var v = 0; v < villain3DInstances.length; v++) {
      if (villain3DInstances[v].mesh) scene3D.remove(villain3DInstances[v].mesh);
    }
    villain3DInstances = [];

    for (var id in gate3DPreviewInstances) {
      var list = gate3DPreviewInstances[id];
      for (var k = 0; k < list.length; k++) scene3D.remove(list[k].mesh);
    }
    gate3DPreviewInstances = {};

    for (var oId in obstacle3DInstances) {
      var oList = obstacle3DInstances[oId];
      for (var m = 0; m < oList.length; m++) scene3D.remove(oList[m]);
    }
    obstacle3DInstances = {};
    
    var startY = -120;
    for (var j = 0; j < 4; j++) {
      spawnObstacleAt(startY);
      startY -= randInt(280, 320);
    }
  }

  function burst(x, y, n, color, spread, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.2832, sp = Math.random() * power;
      particles.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 2.2 + Math.random() * 3.5,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        color: color
      });
    }
  }

  function crowdWidth() {
    return Math.max(20, Math.min(230, 22 + Math.sqrt(crowd) * 7.5));
  }

  /* ---------- Collision Resolution ---------- */
  function resolveGate(g) {
    var seg = null;
    for (var i = 0; i < g.segs.length; i++) {
      var leftEdge = g.segs[i].x0 + (g.moveOffset || 0);
      var rightEdge = g.segs[i].x1 + (g.moveOffset || 0);
      if (crowdX >= leftEdge && crowdX <= rightEdge) {
        seg = g.segs[i];
        break;
      }
    }

    if (!seg) {
      // Player was standing in the center barrier gap! Penalty for AFK center positioning!
      sfx.lose();
      shake = Math.max(shake, 0.4);
      popups.push({
        x: crowdX,
        y: crowdY - 44,
        life: 1,
        text: '🛑 CENTER BARRIER!',
        color: '255,100,50'
      });
      burst(crowdX, crowdY, 15, '255,100,50', crowdWidth(), 3.0);
      crowd = Math.max(0, crowd - 2);
      if (crowd <= 0) return crash();
      return;
    }

    var before = crowd;
    crowd = applyOp(crowd, seg);
    if (crowd < 0) crowd = 0;
    var delta = crowd - before;

    if (seg.neg) {
      sfx.lose();
      shake = Math.max(shake, 0.4);
      popups.push({
        x: crowdX,
        y: crowdY - 44,
        life: 1,
        text: '🧟 ATTACK!',
        color: '255,65,65'
      });
      burst(crowdX, crowdY, 18, '255,60,60', crowdWidth(), 3.2);

      var gateX3D = ((seg.x0 + seg.x1) / 2 - W / 2) * 0.046;
      spawnVillainArmyWave(Math.abs(delta) + 4, gateX3D, -35);

    } else {
      sfx.gain();
      jumpTimer = 0.65;
      score += 50 * currentLevel; // Gate points bonus scaled with level
      popups.push({
        x: crowdX,
        y: crowdY - 44,
        life: 1,
        text: '🏃 REINFORCE!',
        color: '255,235,59'
      });
      burst(crowdX, crowdY, 20, '255,235,59', crowdWidth(), 3.0);
    }

    if (crowd <= 0) return crash();
    peak = Math.max(peak, crowd);
  }

  function resolveToll(o) {
    if (crowd >= o.req) {
      var cost = Math.round(o.req * 0.45);
      crowd = Math.max(1, crowd - cost);
      score += o.req * currentLevel;
      sfx.toll();
      shake = 0.5;
      popups.push({ x: crowdX, y: crowdY - 44, life: 1, text: '💥 BREAKTHROUGH!', color: '255,235,59' });
      burst(W / 2, crowdY, 32, '255,167,38', W * 0.7, 5.0);
    } else {
      crowd = 0;
      popups.push({ x: crowdX, y: crowdY - 44, life: 1, text: '🛑 BLOCKED!', color: '255,50,50' });
      crash();
    }
  }

  function crash() {
    alive = false;
    sfx.crash();
    shake = 0.8;
    burst(crowdX, crowdY, 35, '255,60,60', crowdWidth() * 1.2, 5.5);
    setTimeout(gameOver, 350);
  }

  /* ---------- Main Physics & Render Loop ---------- */
  var last = 0;

  function step(dt) {
    tclock += dt;

    // Running speed increases progressively with Level and Distance
    var speedMult = 1 + (currentLevel - 1) * 0.22 + Math.min(1.2, distance * 0.0003);
    var speed = 200 * speedMult;

    if (pointerActive) {
      crowdX += (tx - crowdX) * Math.min(1, dt * 18);
    } else if (kInput !== 0) {
      vx += kInput * 2200 * dt;
    }

    vx *= Math.pow(0.0001, dt);
    crowdX += vx * dt;

    var cw = crowdWidth();
    var minX = cw / 2 + 12;
    var maxX = W - cw / 2 - 12;

    if (wallHitTimer > 0) wallHitTimer = Math.max(0, wallHitTimer - dt);

    if (crowdX <= minX || crowdX >= maxX) {
      if (wallHitTimer <= 0) {
        wallHitTimer = 0.45; // Wall hit cooldown
        sfx.lose();
        shake = Math.max(shake, 0.55);
        popups.push({
          x: crowdX <= minX ? minX + 22 : maxX - 22,
          y: crowdY - 40,
          life: 1,
          text: '💥 WALL HIT! (-10)',
          color: '255,60,60'
        });
        burst(crowdX <= minX ? minX : maxX, crowdY, 16, '255,60,60', 25, 4.2);
        crowd = Math.max(0, crowd - 10);
        if (crowdX <= minX) vx = Math.abs(vx) * 0.5 + 120;
        else vx = -Math.abs(vx) * 0.5 - 120;

        if (crowd <= 0) return crash();
      }
    }

    crowdX = Math.max(minX, Math.min(maxX, crowdX));

    distance += (speed * dt) / 10;

    // Points multiplier scales up with currentLevel
    var pointMult = 1 + (currentLevel - 1) * 0.50;
    score = Math.max(score, Math.floor(distance * 2.5 * pointMult) + (peak - 6) * 20 + (currentLevel - 1) * 300);

    if (jumpTimer > 0) jumpTimer = Math.max(0, jumpTimer - dt);

    if (distance >= milestoneNext) {
      milestoneNext += 500;
      var newLevel = currentLevel + 1;
      currentLevel = newLevel;
      score += currentLevel * 500; // Level completion bonus
      sfx.levelUp();
      jumpTimer = 1.0;
      levelToast = { text: 'LEVEL ' + currentLevel + '! 🚀', subtext: 'Speed Up!', life: 2.0, scale: 0 };
      burst(W / 2, H * 0.35, 28, '255,235,59', 160, 4.2);
    }

    if (levelToast.life > 0) {
      levelToast.life -= dt;
      if (levelToast.scale < 1) levelToast.scale = Math.min(1, levelToast.scale + dt * 5);
    }

    var highestY = getHighestObstacleY();
    if (highestY > -120) {
      spawnObstacleAt(highestY - randInt(270, 320));
    }

    for (var i = obstacles.length - 1; i >= 0; i--) {
      var o = obstacles[i];
      o.y += speed * dt;

      if (o.isMoving) {
        o.moveOffset += o.moveDir * (45 * speedMult) * dt;
        if (Math.abs(o.moveOffset) > 28) o.moveDir *= -1;
      }

      if (!o.resolved && o.y >= crowdY) {
        o.resolved = true;
        if (o.type === 'gate') resolveGate(o); else resolveToll(o);
        if (!alive) return;
      }
      if (o.y > H + 60) obstacles.splice(i, 1);
    }

    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.x += pt.vx * dt * 60; pt.y += pt.vy * dt * 60; pt.vy += 0.35 * dt * 60 * 0.02;
      pt.life -= pt.decay * dt * 60;
      if (pt.life <= 0) particles.splice(p, 1);
    }
    for (var u = popups.length - 1; u >= 0; u--) {
      popups[u].y -= 0.7 * dt * 60;
      popups[u].life -= 0.02 * dt * 60;
      if (popups[u].life <= 0) popups.splice(u, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - 2.6 * dt);
  }

  function ambient(dt) {
    tclock += dt;
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.x += pt.vx * dt * 60; pt.y += pt.vy * dt * 60;
      pt.life -= pt.decay * dt * 60;
      if (pt.life <= 0) particles.splice(p, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - 2.6 * dt);
  }

  function drawCrowdNumberBadge() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 16px Fredoka, sans-serif';

    var label = '⚔️ ' + String(Math.round(crowd));
    var tw = ctx.measureText(label).width;

    ctx.fillStyle = 'rgba(27,56,43,0.88)';
    roundRect(crowdX - tw / 2 - 10, crowdY - 56, tw + 20, 25, 12);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, crowdX, crowdY - 38);
    ctx.restore();
  }

  function drawGate(o) {
    // 2D gate boxes disabled as per user request
  }

  function drawToll(o) {
    // 3D Barb+wire.fbx obstacle model rendered in WebGL scene
  }

  function render(dt) {
    var vw = canvas.width, vh = canvas.height;

    // 1. Render 3D Scene
    if (renderer3D && scene3D && camera3D) {
      update3DMob(dt || 0.016);
      renderer3D.render(scene3D, camera3D);
    }

    // 2. Render 2D Overlay HUD & Gates
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    if (!renderer3D) {
      var chaos = Math.min(1, distance / 5000);
      var g = ctx.createLinearGradient(0, 0, 0, vh);
      g.addColorStop(0, shade('#26634c', -chaos * 0.3));
      g.addColorStop(0.5, shade('#1e4d3b', -chaos * 0.25));
      g.addColorStop(1, shade('#0f2b20', -chaos * 0.15));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vw, vh);
    }

    ctx.setTransform(scale, 0, 0, scale, (Math.random() - 0.5) * shake * 8 * scale, offY + (Math.random() - 0.5) * shake * 8 * scale);

    // Render Gates and Obstacles
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.y < -60 || o.y > H + 60) continue;
      if (o.type === 'gate') drawGate(o); else drawToll(o);
    }

    // Render Crowd 3D Badge
    if (alive) {
      drawCrowdNumberBadge();
    }

    // Particles
    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = 'rgb(' + pt.color + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r * pt.life, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Popups
    ctx.textAlign = 'center';
    ctx.font = '700 17px Fredoka, sans-serif';
    for (var u = 0; u < popups.length; u++) {
      ctx.globalAlpha = Math.max(0, popups[u].life);
      ctx.fillStyle = 'rgb(' + popups[u].color + ')';
      ctx.fillText(popups[u].text, popups[u].x, popups[u].y);
    }
    ctx.globalAlpha = 1;

    // Floating Level Up Toast Banner
    if (levelToast && levelToast.life > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, levelToast.life * 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 235, 59, 0.94)';
      roundRect(W / 2 - 110, H * 0.32, 220, 50, 20);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.5;
      roundRect(W / 2 - 110, H * 0.32, 220, 50, 20);
      ctx.stroke();

      ctx.fillStyle = '#0b381a';
      ctx.font = '700 24px Fredoka, sans-serif';
      ctx.fillText(levelToast.text, W / 2, H * 0.32 + 34);
      ctx.restore();
    }

    if (state === STATE_PLAY) {
      // Level Badge (Top Left Pill)
      ctx.save();
      ctx.fillStyle = 'rgba(255, 235, 59, 0.95)';
      roundRect(14, 20, 96, 30, 15);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      roundRect(14, 20, 96, 30, 15);
      ctx.stroke();

      ctx.fillStyle = '#0b381a';
      ctx.font = '700 13.5px Fredoka, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LVL ' + currentLevel + ' 🌟', 62, 40);
      ctx.restore();

      // Score Header (Centered)
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 52px Fredoka, sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 10;
      ctx.fillText(String(score), W / 2, 60);

      ctx.font = '600 14px Fredoka, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(Math.floor(distance) + ' m · Peak ' + peak + ' Troops', W / 2, 80);
      ctx.restore();
    }
  }

  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;

    if (state === STATE_PLAY) {
      step(dt);
      render(dt);
    } else {
      ambient(dt);
      render(dt);
    }
  }

  /* ---------- UI Controls & State Handlers ---------- */
  var titleEl = document.getElementById('title');
  var overEl = document.getElementById('over');
  var overCard = document.getElementById('overCard');
  var overTitle = document.getElementById('overTitle');
  var finalEl = document.getElementById('finalScore');
  var tierLine = document.getElementById('tierLine');
  var bestLine = document.getElementById('bestLine');
  var mobileControls = document.getElementById('mobileControls');
  var overShownAt = 0;

  var LINES = [
    'Great Try! 🎉',
    'Super Effort! ⭐',
    'Almost Made It! 🚀',
    'Keep Going! 🎈'
  ];

  function startGame() {
    try { initAudio(); } catch (err) {}
    reset();
    state = STATE_PLAY;
    startBGM();
    if (titleEl) {
      titleEl.classList.add('hidden');
      titleEl.style.display = 'none';
    }
    if (overEl) {
      overEl.classList.add('hidden');
      overEl.style.display = 'none';
    }
    if (mobileControls) mobileControls.classList.remove('hidden');
    last = 0;
  }

  function gameOver() {
    state = STATE_OVER;
    stopBGM();
    sfx.gameOver();

    if (score > best) {
      best = score;
      try { localStorage.setItem('mob_best', String(best)); } catch (e) {}
      bestLine.textContent = '🏆 New Best Record!';
    } else {
      bestLine.textContent = '🏆 Best Record: ' + best;
    }
    overTitle.textContent = LINES[(Math.random() * LINES.length) | 0];
    finalEl.textContent = score;
    tierLine.textContent = 'Level ' + currentLevel + ' Reached · ' + Math.floor(distance) + ' m Marched · Peak ' + peak + ' Troops';
    if (overEl) {
      overEl.classList.remove('hidden');
      overEl.style.display = 'flex';
    }
    if (mobileControls) mobileControls.classList.add('hidden');

    if (overCard) {
      overCard.classList.remove('fade');
      void overCard.offsetWidth;
      overCard.classList.add('fade');
    }
    overShownAt = Date.now();
    pointerActive = false;
  }

  var startBtn = document.getElementById('startBtn');
  var againBtn = document.getElementById('againBtn');

  var handleStart = function (e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    startGame();
  };

  if (startBtn) {
    startBtn.addEventListener('click', handleStart);
    startBtn.addEventListener('pointerdown', handleStart);
  }

  if (titleEl) {
    titleEl.addEventListener('click', handleStart);
    titleEl.addEventListener('pointerdown', handleStart);
  }

  if (againBtn) {
    againBtn.addEventListener('click', handleStart);
    againBtn.addEventListener('pointerdown', handleStart);
  }

  if (overEl) {
    overEl.addEventListener('pointerdown', function () {
      if (state === STATE_OVER && Date.now() - overShownAt > 300) startGame();
    });
  }

  /* Touch steering buttons */
  var leftBtn = document.getElementById('leftBtn');
  var rightBtn = document.getElementById('rightBtn');

  if (leftBtn && rightBtn) {
    var bindTouch = function (btn, dir) {
      var start = function (e) { e.preventDefault(); e.stopPropagation(); touchDir = dir; };
      var end = function (e) { e.preventDefault(); e.stopPropagation(); if (touchDir === dir) touchDir = 0; };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
      btn.addEventListener('mouseleave', end);
    };
    bindTouch(leftBtn, -1);
    bindTouch(rightBtn, 1);
  }

  /* Canvas Touch Drag Input */
  function toWorldX(e) {
    var r = canvas.getBoundingClientRect();
    return (e.clientX - r.left) / r.width * W;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (state !== STATE_PLAY) {
      startGame();
      return;
    }
    pointerActive = true; tx = toWorldX(e);
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!pointerActive) return;
    tx = toWorldX(e); e.preventDefault();
  });

  function release() { pointerActive = false; }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);

  /* Keyboard controls */
  var KEYS = { ArrowLeft: -1, a: -1, ArrowRight: 1, d: 1 };
  window.addEventListener('keydown', function (e) {
    if (state !== STATE_PLAY) {
      startGame();
    }
    if (KEYS[e.key] !== undefined) { kInput = KEYS[e.key]; e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    if (KEYS[e.key] !== undefined && Math.sign(kInput) === KEYS[e.key]) kInput = 0;
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopBGM();
      last = 0;
    } else {
      if (state === STATE_PLAY) startBGM();
      last = 0;
    }
  });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* Boot Game */
  resize();
  init3D();
  reset();
  if (bestLine) bestLine.textContent = '🏆 Best Record: ' + best;
  requestAnimationFrame(loop);
})();
