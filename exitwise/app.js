(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const state = {
    sound: true,
    audio: null,
    ways: { score: 0, round: 0, picks: [], phase: "intro", timer: null },
    crowd: { running: false, animation: 0, keys: new Set(), pointer: null }
  };

  const storage = {
    get(key, fallback = 0) {
      try { return Number(localStorage.getItem(key)) || fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, String(value)); } catch { /* Private mode can disable storage. */ }
    }
  };

  function updateStoredScores() {
    const waysBest = storage.get("exitwise-ways-best");
    const crowdBest = storage.get("exitwise-crowd-best");
    $("#ways-best").textContent = waysBest ? `Best ${waysBest}` : "Best —";
    $("#crowd-best").textContent = crowdBest ? `Best ${crowdBest}` : "Best —";
    $("#total-points").textContent = waysBest + crowdBest;
  }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => toast.classList.remove("show"), 1900);
  }

  function tone(frequency = 440, duration = .08, type = "sine", volume = .04) {
    if (!state.sound) return;
    try {
      state.audio ||= new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = state.audio.createOscillator();
      const gain = state.audio.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, state.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, state.audio.currentTime + duration);
      oscillator.connect(gain).connect(state.audio.destination);
      oscillator.start();
      oscillator.stop(state.audio.currentTime + duration);
    } catch { /* Audio is optional. */ }
  }

  function successSound() {
    tone(440, .12, "triangle", .05);
    setTimeout(() => tone(660, .14, "triangle", .045), 90);
  }

  function setScreen(id) {
    if (state.crowd.running && id !== "crowd") stopCrowdGame(false);
    clearInterval(state.ways.timer);
    $$(".screen").forEach(screen => screen.classList.toggle("is-active", screen.id === id));
    window.scrollTo({ top: 0, behavior: "instant" });
    if (id === "ways") resetWaysView();
    if (id === "crowd") resetCrowdView();
    const heading = $(`#${id} h1, #${id} h2`);
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    }
  }

  $$("[data-screen]").forEach(button => {
    button.addEventListener("click", () => setScreen(button.dataset.screen));
  });
  $("[data-scroll-games]").addEventListener("click", () => $("#games").scrollIntoView({ behavior: "smooth" }));

  $$("[data-sound-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      state.sound = !state.sound;
      $$("[data-sound-toggle]").forEach(control => {
        control.setAttribute("aria-pressed", String(state.sound));
        $(".sound-label", control).textContent = state.sound ? "Sound on" : "Sound off";
        control.firstElementChild.textContent = state.sound ? "◖))" : "◖×";
      });
      if (state.sound) tone(520);
    });
  });

  // -------------------------
  // Game 1: Two Ways Out
  // -------------------------
  const venueRounds = [
    {
      position: ["48%", "63%"],
      unavailable: "D",
      best: ["A", "C"],
      hazard: ["31%", "76%", "Crowd surge"],
      alert: "The main doors are congested. Pick two other ways out.",
      note: "Good scan. When the entrance jams, side exits give you options."
    },
    {
      position: ["39%", "48%"],
      unavailable: "B",
      best: ["A", "D"],
      hazard: ["71%", "10%", "Smoke reported"],
      alert: "Smoke is moving into the side hall. Choose two clear routes.",
      note: "You kept clear of smoke and preserved an alternative route."
    },
    {
      position: ["56%", "54%"],
      unavailable: "A",
      best: ["B", "C"],
      hazard: ["57%", "1%", "Fallen barrier"],
      alert: "The west lobby is blocked. Find two exits on the open side.",
      note: "You adapted instead of forcing the route you first planned."
    }
  ];

  function resetWaysView() {
    state.ways.phase = "intro";
    clearInterval(state.ways.timer);
    $("#ways-intro").classList.remove("is-hidden");
    $("#venue-game").classList.add("is-hidden");
    $("#ways-results").classList.add("is-hidden");
    $("#ways-round").textContent = "1 / 3";
    $("#ways-score").textContent = "000";
    $("#ways-progress").style.width = "0%";
  }

  $("#start-ways").addEventListener("click", startWaysGame);
  $("#replay-ways").addEventListener("click", startWaysGame);

  function startWaysGame() {
    state.ways.score = 0;
    state.ways.round = 0;
    $("#ways-intro").classList.add("is-hidden");
    $("#ways-results").classList.add("is-hidden");
    $("#venue-game").classList.remove("is-hidden");
    loadVenueRound();
    tone(330, .08, "square", .025);
  }

  function loadVenueRound() {
    const round = venueRounds[state.ways.round];
    state.ways.picks = [];
    state.ways.phase = "scan";
    clearInterval(state.ways.timer);
    $("#ways-round").textContent = `${state.ways.round + 1} / ${venueRounds.length}`;
    $("#ways-progress").style.width = `${(state.ways.round / venueRounds.length) * 100}%`;
    $("#venue-phase-label").textContent = "Scan phase";
    $("#venue-prompt").textContent = "Find and remember every exit.";
    $("#venue-you").style.left = round.position[0];
    $("#venue-you").style.top = round.position[1];
    $("#hazard-layer").replaceChildren();
    $("#route-canvas").replaceChildren();
    $("#venue-board").classList.remove("memory-mode");
    $("#pick-one").textContent = "Route 1: —";
    $("#pick-two").textContent = "Route 2: —";
    $(".venue-feedback p").innerHTML = "Scan the floor plan. <strong>You’ll need two routes.</strong>";
    $$(".exit-door").forEach(door => {
      door.disabled = true;
      door.classList.remove("selected", "unsafe");
    });

    let remaining = 6;
    $("#timer-number").textContent = remaining;
    $(".timer-ring").style.strokeDashoffset = "0";
    state.ways.timer = setInterval(() => {
      remaining -= 1;
      $("#timer-number").textContent = remaining;
      $(".timer-ring").style.strokeDashoffset = String(107 * (1 - remaining / 6));
      if (remaining <= 0) {
        clearInterval(state.ways.timer);
        beginVenueDecision();
      } else {
        tone(260 + remaining * 16, .035, "square", .018);
      }
    }, 1000);
  }

  function beginVenueDecision() {
    const round = venueRounds[state.ways.round];
    state.ways.phase = "choose";
    $("#venue-phase-label").textContent = "Adapt phase";
    $("#venue-prompt").textContent = round.alert;
    $("#scan-timer").style.visibility = "hidden";
    $("#venue-board").classList.add("memory-mode");
    const hazard = document.createElement("div");
    hazard.className = "hazard";
    hazard.style.left = round.hazard[0];
    hazard.style.top = round.hazard[1];
    hazard.textContent = round.hazard[2];
    $("#hazard-layer").append(hazard);
    $$(".exit-door").forEach(door => {
      door.disabled = false;
      door.classList.toggle("unsafe", door.dataset.exit === round.unavailable);
    });
    $(".venue-feedback p").innerHTML = "Select <strong>two different safe exits.</strong>";
    tone(155, .28, "sawtooth", .03);
    setTimeout(() => { $("#scan-timer").style.visibility = "visible"; }, 50);
    $("#timer-number").textContent = "GO";
  }

  $$(".exit-door").forEach(door => {
    door.addEventListener("click", () => chooseVenueExit(door));
  });

  function chooseVenueExit(door) {
    if (state.ways.phase !== "choose") return;
    const exit = door.dataset.exit;
    const round = venueRounds[state.ways.round];

    if (exit === round.unavailable) {
      state.ways.score = Math.max(0, state.ways.score - 10);
      updateWaysScore();
      showToast("That route is compromised — choose another.");
      tone(125, .18, "sawtooth", .04);
      door.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
        { duration: 260 }
      );
      return;
    }

    if (state.ways.picks.includes(exit)) {
      showToast("Choose a different second exit.");
      tone(190, .08, "square", .025);
      return;
    }

    state.ways.picks.push(exit);
    door.classList.add("selected");
    $(`#pick-${state.ways.picks.length === 1 ? "one" : "two"}`).textContent =
      `Route ${state.ways.picks.length}: Exit ${exit}`;
    drawVenueRoute(door);
    state.ways.score += 50;
    updateWaysScore();
    tone(420 + state.ways.picks.length * 110, .1, "triangle", .04);

    if (state.ways.picks.length === 2) finishVenueRound();
  }

  function drawVenueRoute(door) {
    const board = $("#venue-board").getBoundingClientRect();
    const start = $("#venue-you").getBoundingClientRect();
    const end = door.getBoundingClientRect();
    const x1 = start.left + start.width / 2 - board.left;
    const y1 = start.top + start.height / 2 - board.top;
    const x2 = end.left + end.width / 2 - board.left;
    const y2 = end.top + end.height / 2 - board.top;
    const distance = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
    const line = document.createElement("i");
    line.className = "route-dash";
    line.style.left = `${x1}px`;
    line.style.top = `${y1}px`;
    line.style.width = `${distance}px`;
    line.style.setProperty("--rotation", `rotate(${angle}deg)`);
    $("#route-canvas").append(line);
  }

  function updateWaysScore() {
    $("#ways-score").textContent = String(state.ways.score).padStart(3, "0");
  }

  function finishVenueRound() {
    const round = venueRounds[state.ways.round];
    state.ways.phase = "feedback";
    $$(".exit-door").forEach(door => { door.disabled = true; });
    const pickedBestPair = round.best.every(exit => state.ways.picks.includes(exit));
    if (pickedBestPair) state.ways.score += 25;
    updateWaysScore();
    $(".venue-feedback p").innerHTML = `<strong>${pickedBestPair ? "+25 Best pair." : "Two routes secured."}</strong> ${round.note}`;
    successSound();

    setTimeout(() => {
      state.ways.round += 1;
      if (state.ways.round < venueRounds.length) {
        loadVenueRound();
      } else {
        finishWaysGame();
      }
    }, 2200);
  }

  function finishWaysGame() {
    $("#venue-game").classList.add("is-hidden");
    $("#ways-results").classList.remove("is-hidden");
    $("#ways-progress").style.width = "100%";
    $("#ways-final-score").textContent = state.ways.score;
    const great = state.ways.score >= 350;
    $("#ways-result-title").textContent = great ? "You read the room." : "Options kept open.";
    $("#ways-result-copy").textContent = great
      ? "You spotted alternatives and changed course as the venue changed."
      : "You found two ways out each time. Keep scanning for hazards before committing.";
    if (state.ways.score > storage.get("exitwise-ways-best")) {
      storage.set("exitwise-ways-best", state.ways.score);
      showToast("New best score!");
    }
    updateStoredScores();
    successSound();
  }

  // -------------------------
  // Game 2: Exit First
  // -------------------------
  const crowdCanvas = $("#crowd-canvas");
  const ctx = crowdCanvas.getContext("2d");
  const W = crowdCanvas.width;
  const H = crowdCanvas.height;
  const crowdGame = {
    player: { x: 68, y: 442, r: 14, speed: 185 },
    agents: [],
    space: 100,
    score: 0,
    elapsed: 0,
    duration: 45,
    last: 0,
    nearTime: 0,
    edgeTime: 0,
    flowTime: 0,
    startTime: 0,
    ended: false
  };

  function resetCrowdView() {
    stopCrowdGame(false);
    $("#crowd-intro").classList.remove("is-hidden");
    $("#crowd-game").classList.add("is-hidden");
    $("#crowd-results").classList.add("is-hidden");
    $("#crowd-time").textContent = "0:45";
    $("#crowd-score").textContent = "000";
    $("#space-meter").style.width = "100%";
  }

  $("#start-crowd").addEventListener("click", startCrowdGame);
  $("#replay-crowd").addEventListener("click", startCrowdGame);

  function createCrowd() {
    const agents = [];
    const colors = ["#34322d", "#4f755f", "#c65a41", "#7d776d", "#315e52"];
    let id = 0;

    // Three moving bands leave readable gaps at the edges.
    [
      { y1: 92, y2: 200, count: 22, vx: 34 },
      { y1: 215, y2: 340, count: 30, vx: 48 },
      { y1: 350, y2: 450, count: 20, vx: 27 }
    ].forEach((band, bandIndex) => {
      for (let i = 0; i < band.count; i += 1) {
        const column = i % Math.ceil(band.count / 3);
        const row = Math.floor(i / Math.ceil(band.count / 3));
        agents.push({
          id: id++,
          x: 120 + column * 95 + (row % 2) * 34 + bandIndex * 16,
          y: band.y1 + row * ((band.y2 - band.y1) / 2) + (i % 3) * 5,
          r: 10 + (i % 3),
          vx: band.vx + (i % 5) * 4,
          vy: Math.sin(i * 2.1) * 3,
          color: colors[i % colors.length],
          phase: i * .7
        });
      }
    });
    return agents;
  }

  function startCrowdGame() {
    stopCrowdGame(false);
    Object.assign(crowdGame.player, { x: 68, y: 442 });
    crowdGame.agents = createCrowd();
    crowdGame.space = 100;
    crowdGame.score = 0;
    crowdGame.elapsed = 0;
    crowdGame.nearTime = 0;
    crowdGame.edgeTime = 0;
    crowdGame.flowTime = 0;
    crowdGame.ended = false;
    crowdGame.last = performance.now();
    crowdGame.startTime = crowdGame.last;
    state.crowd.keys.clear();
    state.crowd.pointer = null;
    state.crowd.running = true;
    $("#crowd-intro").classList.add("is-hidden");
    $("#crowd-results").classList.add("is-hidden");
    $("#crowd-game").classList.remove("is-hidden");
    $$(".live-lessons span").forEach(item => item.classList.remove("lesson-active"));
    $("#lesson-space").classList.add("lesson-active");
    $("#crowd-callout strong").textContent = "Look for open space, not the shortest line.";
    tone(330, .09, "square", .025);
    state.crowd.animation = requestAnimationFrame(crowdLoop);
  }

  function stopCrowdGame(markEnded = true) {
    state.crowd.running = false;
    cancelAnimationFrame(state.crowd.animation);
    state.crowd.keys.clear();
    state.crowd.pointer = null;
    if (markEnded) crowdGame.ended = true;
  }

  function crowdLoop(now) {
    if (!state.crowd.running) return;
    const dt = Math.min(.035, (now - crowdGame.last) / 1000);
    crowdGame.last = now;
    updateCrowd(dt);
    drawCrowd(now);
    if (state.crowd.running) state.crowd.animation = requestAnimationFrame(crowdLoop);
  }

  function movementVector() {
    let dx = 0;
    let dy = 0;
    const keys = state.crowd.keys;
    if (keys.has("arrowleft") || keys.has("a") || keys.has("left")) dx -= 1;
    if (keys.has("arrowright") || keys.has("d") || keys.has("right")) dx += 1;
    if (keys.has("arrowup") || keys.has("w") || keys.has("up")) dy -= 1;
    if (keys.has("arrowdown") || keys.has("s") || keys.has("down")) dy += 1;

    if (state.crowd.pointer) {
      const pdx = state.crowd.pointer.x - crowdGame.player.x;
      const pdy = state.crowd.pointer.y - crowdGame.player.y;
      if (Math.hypot(pdx, pdy) > 10) {
        dx = pdx;
        dy = pdy;
      }
    }
    const length = Math.hypot(dx, dy);
    return length ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
  }

  function updateCrowd(dt) {
    crowdGame.elapsed += dt;
    const player = crowdGame.player;
    const move = movementVector();
    const densitySlowdown = .64 + crowdGame.space / 275;
    player.x = clamp(player.x + move.x * player.speed * densitySlowdown * dt, player.r, W - player.r);
    player.y = clamp(player.y + move.y * player.speed * densitySlowdown * dt, player.r, H - player.r);

    crowdGame.agents.forEach(agent => {
      agent.x += agent.vx * dt;
      agent.y += Math.sin(crowdGame.elapsed * 1.2 + agent.phase) * agent.vy * dt;
      if (agent.x > W + 30) agent.x = -30;
    });

    let nearest = Infinity;
    let nearby = 0;
    crowdGame.agents.forEach(agent => {
      const dx = player.x - agent.x;
      const dy = player.y - agent.y;
      const distance = Math.hypot(dx, dy);
      nearest = Math.min(nearest, distance);
      if (distance < 53) nearby += 1;
      const overlap = player.r + agent.r + 3 - distance;
      if (overlap > 0 && distance > 0) {
        // The crowd displaces the player, but never locks movement completely.
        player.x += (dx / distance) * overlap * .24;
        player.y += (dy / distance) * overlap * .24;
      }
    });

    const pressure = Math.max(0, 45 - nearest) * .22 + Math.max(0, nearby - 1) * 3.5;
    if (pressure > 0) {
      crowdGame.space = Math.max(8, crowdGame.space - pressure * dt * 4.2);
      crowdGame.nearTime += dt;
    } else {
      crowdGame.space = Math.min(100, crowdGame.space + 7 * dt);
    }
    if (nearest > 54) crowdGame.score += dt * 3;
    if (move.x > .35) crowdGame.flowTime += dt;
    if (player.y < 75 || player.y > H - 75) crowdGame.edgeTime += dt;

    const remaining = Math.max(0, Math.ceil(crowdGame.duration - crowdGame.elapsed));
    $("#crowd-time").textContent = `0:${String(remaining).padStart(2, "0")}`;
    $("#space-meter").style.width = `${crowdGame.space}%`;
    $("#space-meter").style.background = crowdGame.space < 35 ? "#c94a32" : "#3f785f";
    $("#crowd-score").textContent = String(Math.round(crowdGame.score)).padStart(3, "0");

    updateCrowdLessons(player, move, nearby);

    if (player.x > W - 43 && player.y < 145) {
      finishCrowdGame(true);
    } else if (crowdGame.elapsed >= crowdGame.duration) {
      finishCrowdGame(false);
    }
  }

  function updateCrowdLessons(player, move, nearby) {
    $("#lesson-space").classList.toggle("lesson-active", nearby <= 1);
    $("#lesson-flow").classList.toggle("lesson-active", move.x > .25);
    $("#lesson-edge").classList.toggle("lesson-active", player.y < 82 || player.y > H - 82);
    let message = "Look for open space, not the shortest line.";
    if (nearby >= 3) message = "Dense patch — ease sideways toward open space.";
    else if (crowdGame.space < 45) message = "Protect your balance. Don’t fight the flow.";
    else if (player.y < 82 || player.y > H - 82) message = "Good: the edge gives you room to angle out.";
    else if (player.x > W * .66) message = "You’re close. Keep the green exit in sight.";
    $("#crowd-callout strong").textContent = message;
  }

  function drawCrowd(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#dcd8cd";
    ctx.fillRect(0, 0, W, H);

    // Floor grid and directional flow marks.
    ctx.strokeStyle = "rgba(36,35,31,.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(63,120,95,.26)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 12]);
    [75, 270, 470].forEach(y => {
      ctx.beginPath(); ctx.moveTo(25, y); ctx.lineTo(W - 25, y); ctx.stroke();
    });
    ctx.setLineDash([]);

    // Safe exit target.
    ctx.fillStyle = "#b8e562";
    ctx.strokeStyle = "#24231f";
    ctx.lineWidth = 4;
    ctx.fillRect(W - 42, 24, 42, 120);
    ctx.strokeRect(W - 42, 24, 42, 120);
    ctx.fillStyle = "#24231f";
    ctx.font = "700 18px Manrope, sans-serif";
    ctx.fillText("→", W - 31, 91);

    // Crowd members: soft personal-space rings, body, then head.
    crowdGame.agents.forEach(agent => {
      ctx.beginPath();
      ctx.fillStyle = "rgba(36,35,31,.035)";
      ctx.arc(agent.x, agent.y, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = agent.color;
      ctx.strokeStyle = "#24231f";
      ctx.lineWidth = 2;
      ctx.ellipse(agent.x, agent.y + 5, agent.r * .75, agent.r * 1.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = "#f0c7a6";
      ctx.arc(agent.x, agent.y - agent.r, agent.r * .55, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // Player aura pulses as space drops.
    const player = crowdGame.player;
    const pulse = Math.sin(now / 180) * 2;
    ctx.beginPath();
    ctx.fillStyle = crowdGame.space < 35 ? "rgba(239,106,75,.24)" : "rgba(240,205,91,.30)";
    ctx.strokeStyle = crowdGame.space < 35 ? "#c94a32" : "#24231f";
    ctx.lineWidth = 2;
    ctx.arc(player.x, player.y, 28 + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = "#f0cd5b";
    ctx.strokeStyle = "#24231f";
    ctx.lineWidth = 4;
    ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#24231f";
    ctx.font = "700 11px DM Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillText("YOU", player.x, player.y + 4);
    ctx.textAlign = "start";
  }

  function finishCrowdGame(reachedExit) {
    if (crowdGame.ended) return;
    stopCrowdGame(true);
    const timeBonus = reachedExit ? Math.round((crowdGame.duration - crowdGame.elapsed) * 6) : 0;
    const spaceBonus = Math.round(crowdGame.space * 1.5);
    const habitsBonus = Math.min(120, Math.round((crowdGame.edgeTime + crowdGame.flowTime) * 2));
    crowdGame.score = Math.round(crowdGame.score + timeBonus + spaceBonus + habitsBonus);
    $("#crowd-game").classList.add("is-hidden");
    $("#crowd-results").classList.remove("is-hidden");
    $("#crowd-final-score").textContent = crowdGame.score;
    $("#crowd-result-title").textContent = reachedExit ? "Calm beats fast." : "Awareness buys time.";
    $("#crowd-result-copy").textContent = reachedExit
      ? "You found space and moved with the flow instead of fighting it."
      : "Time ran out, but every open lane you found protected your space. Try the outer edge next.";
    $("#crowd-results .eyebrow").textContent = reachedExit ? "You made it out" : "Drill complete";
    if (crowdGame.score > storage.get("exitwise-crowd-best")) {
      storage.set("exitwise-crowd-best", crowdGame.score);
      showToast("New best score!");
    }
    updateStoredScores();
    reachedExit ? successSound() : tone(220, .28, "triangle", .04);
  }

  function crowdKey(event, pressed) {
    const key = event.key.toLowerCase();
    if (!["arrowleft", "arrowright", "arrowup", "arrowdown", "w", "a", "s", "d"].includes(key)) return;
    if (state.crowd.running) event.preventDefault();
    if (pressed) state.crowd.keys.add(key);
    else state.crowd.keys.delete(key);
  }
  window.addEventListener("keydown", event => crowdKey(event, true));
  window.addEventListener("keyup", event => crowdKey(event, false));

  $$(".mobile-controls button").forEach(button => {
    const dir = button.dataset.dir;
    const press = event => {
      event.preventDefault();
      state.crowd.keys.add(dir);
      if (event.pointerId !== undefined) button.setPointerCapture?.(event.pointerId);
    };
    const release = event => {
      event.preventDefault();
      state.crowd.keys.delete(dir);
    };
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  });

  function canvasPointer(event) {
    const rect = crowdCanvas.getBoundingClientRect();
    state.crowd.pointer = {
      x: (event.clientX - rect.left) * W / rect.width,
      y: (event.clientY - rect.top) * H / rect.height
    };
  }
  crowdCanvas.addEventListener("pointerdown", event => {
    if (!state.crowd.running) return;
    crowdCanvas.setPointerCapture?.(event.pointerId);
    canvasPointer(event);
  });
  crowdCanvas.addEventListener("pointermove", event => {
    if (state.crowd.pointer) canvasPointer(event);
  });
  crowdCanvas.addEventListener("pointerup", () => { state.crowd.pointer = null; });
  crowdCanvas.addEventListener("pointercancel", () => { state.crowd.pointer = null; });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.crowd.running) {
      crowdGame.last = performance.now();
      state.crowd.keys.clear();
      state.crowd.pointer = null;
    }
  });

  updateStoredScores();
})();
