(function () {
  "use strict";

  var HKT = "Asia/Hong_Kong";
  var SECTIONS = ["local", "international", "finance-global", "finance-hk", "tech"];
  var MAX_ITEMS = 10;
  var WINDOW_MS = 24 * 60 * 60 * 1000;
  var HOUR_MS = 60 * 60 * 1000;
  var requestSerial = 0;
  // Wall-clock gap between silent refreshes of today. Stub this to verify.
  var AUTO_REFRESH_MS = 30 * 60 * 1000;
  var autoRefreshTimer = null;
  var autoRefreshGeneration = 0;
  var lastRefreshAt = 0;
  var activeDate = "";

  function isIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    var utc = new Date(Date.UTC(year, month - 1, day));
    return (
      utc.getUTCFullYear() === year &&
      utc.getUTCMonth() === month - 1 &&
      utc.getUTCDate() === day
    );
  }

  function hktDateString(date) {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: HKT,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    function pick(type) {
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === type) return parts[i].value;
      }
      return "";
    }
    return pick("year") + "-" + pick("month") + "-" + pick("day");
  }

  function parseHkt(value) {
    if (value instanceof Date) return value;
    if (typeof value !== "string") return new Date(NaN);
    var text = value.trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
      text += "+08:00";
    }
    return new Date(text);
  }

  function hktParts(date) {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: HKT,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    var out = { year: "", month: "", day: "", hour: "" };
    for (var i = 0; i < parts.length; i++) {
      if (Object.prototype.hasOwnProperty.call(out, parts[i].type)) {
        out[parts[i].type] = parts[i].value;
      }
    }
    if (out.hour === "24") out.hour = "00";
    return out;
  }

  function hktHourStart(date) {
    var parts = hktParts(date);
    return parseHkt(parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":00:00+08:00");
  }

  // Today (or no date) ends at now. Any other selected day ends at 23:59 HKT,
  // including that minute, so the window covers the calendar day.
  function windowEndFor(selectedDate, today, now) {
    var current = now instanceof Date ? now : new Date(now);
    if (!isIsoDate(selectedDate) || selectedDate === today) return current;
    return parseHkt(selectedDate + "T23:59:59.999+08:00");
  }

  function hourSlots(start, end) {
    var slots = [];
    if (!(start instanceof Date) || !(end instanceof Date)) return slots;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return slots;
    if (end.getTime() < start.getTime()) return slots;
    var cursor = hktHourStart(start);
    var last = hktHourStart(end);
    var guard = 0;
    while (cursor.getTime() <= last.getTime() && guard < 30) {
      var hourStart = cursor.getTime();
      var hourEnd = hourStart + HOUR_MS - 1;
      if (hourStart <= end.getTime() && hourEnd >= start.getTime()) {
        var parts = hktParts(cursor);
        slots.push({
          date: parts.year + "-" + parts.month + "-" + parts.day,
          hour: parts.hour,
        });
      }
      cursor = new Date(hourStart + HOUR_MS);
      guard += 1;
    }
    return slots;
  }

  function formatDateLabel(isoDate) {
    var date = parseHkt(isoDate + "T12:00:00+08:00");
    var datePart = new Intl.DateTimeFormat("zh-Hant-HK", {
      timeZone: HKT,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
    var weekday = new Intl.DateTimeFormat("zh-Hant-HK", {
      timeZone: HKT,
      weekday: "long",
    }).format(date);
    return datePart + "（" + weekday + "）";
  }

  function formatAbsolute(date) {
    var formatted = new Intl.DateTimeFormat("zh-Hant-HK", {
      timeZone: HKT,
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
    return formatted + "（香港時間）";
  }

  function formatClock(date) {
    return new Intl.DateTimeFormat("zh-Hant-HK", {
      timeZone: HKT,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  }

  function relativeLabel(value, now) {
    var then = parseHkt(value);
    var current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(then.getTime()) || Number.isNaN(current.getTime())) return "時間不詳";

    var diff = current.getTime() - then.getTime();
    var abs = Math.abs(diff);
    var future = diff < 0;
    var minute = 60 * 1000;
    var hour = 60 * minute;
    var day = 24 * hour;
    var core;

    if (abs < minute) return "剛剛";
    if (abs < hour) core = Math.floor(abs / minute) + "分鐘";
    else if (abs < day) core = Math.floor(abs / hour) + "小時";
    else if (abs < 30 * day) core = Math.floor(abs / day) + "日";
    else if (abs < 365 * day) core = Math.floor(abs / (30 * day)) + "個月";
    else core = Math.floor(abs / (365 * day)) + "年";

    return future ? core + "後" : core + "前";
  }

  function safeHttpUrl(value) {
    if (typeof value !== "string") return "";
    var text = value.trim();
    if (!text) return "";
    try {
      var url = new URL(text);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.href;
    } catch (err) {
      return "";
    }
  }

  function sourceLabel(source, href) {
    if (source && typeof source.name === "string" && source.name.trim()) {
      return source.name.trim();
    }
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch (err) {
      return "來源";
    }
  }

  function validSources(sources) {
    if (!Array.isArray(sources)) return [];
    var out = [];
    for (var i = 0; i < sources.length; i++) {
      var source = sources[i];
      if (!source || typeof source !== "object") continue;
      var href = safeHttpUrl(source.url);
      if (!href) continue;
      out.push({ name: sourceLabel(source, href), url: href });
    }
    return out;
  }

  function headlineKey(item) {
    if (!item || typeof item.headline !== "string") return "";
    return item.headline.trim();
  }

  function itemTime(item) {
    return parseHkt(item && item.time_hkt);
  }

  function dedupeNewest(items) {
    var best = {};
    var order = [];
    items.forEach(function (item) {
      var key = headlineKey(item);
      if (!key) return;
      var when = itemTime(item);
      if (Number.isNaN(when.getTime())) return;
      var prev = best[key];
      if (!prev) {
        best[key] = item;
        order.push(key);
        return;
      }
      if (when.getTime() >= itemTime(prev).getTime()) best[key] = item;
    });
    return order.map(function (key) {
      return best[key];
    });
  }

  function mergeDigests(digests, start, end) {
    var grouped = {};
    SECTIONS.forEach(function (id) {
      grouped[id] = [];
    });
    var latestUpdate = "";
    var latestUpdateMs = -Infinity;
    var startMs = start.getTime();
    var endMs = end.getTime();

    (Array.isArray(digests) ? digests : []).forEach(function (data) {
      if (!data || typeof data !== "object") return;
      var updated = parseHkt(data.updatedAt);
      if (!Number.isNaN(updated.getTime()) && updated.getTime() >= latestUpdateMs) {
        latestUpdateMs = updated.getTime();
        latestUpdate = typeof data.updatedAt === "string" ? data.updatedAt : "";
      }
      var sections = Array.isArray(data.sections) ? data.sections : [];
      sections.forEach(function (section) {
        if (!section || SECTIONS.indexOf(section.id) === -1) return;
        var items = Array.isArray(section.items) ? section.items : [];
        items.forEach(function (item) {
          var when = itemTime(item);
          if (!headlineKey(item) || Number.isNaN(when.getTime())) return;
          if (when.getTime() < startMs || when.getTime() > endMs) return;
          grouped[section.id].push(item);
        });
      });
    });

    return {
      updatedAt: latestUpdate,
      sections: SECTIONS.map(function (id) {
        var kept = dedupeNewest(grouped[id]);
        kept.sort(function (a, b) {
          return itemTime(b).getTime() - itemTime(a).getTime();
        });
        return { id: id, items: kept.slice(0, MAX_ITEMS) };
      }),
    };
  }

  function pageBase() {
    var url = new URL(window.location.href);
    if (url.pathname.endsWith("/index.html")) {
      url.pathname = url.pathname.slice(0, -"index.html".length);
    } else if (!url.pathname.endsWith("/")) {
      url.pathname += "/";
    }
    url.search = "";
    url.hash = "";
    return url;
  }

  function dataUrl(file) {
    return new URL("data/" + file, pageBase()).href;
  }

  function dateFromQuery() {
    var requested = new URLSearchParams(window.location.search).get("date");
    return isIsoDate(requested) ? requested : "";
  }

  function setStatus(message) {
    var status = document.getElementById("status");
    if (!message) {
      status.hidden = true;
      status.textContent = "";
      return;
    }
    status.hidden = false;
    status.textContent = message;
  }

  function setUpdated(iso) {
    var node = document.getElementById("updatedAt");
    var when = parseHkt(iso);
    if (!iso || Number.isNaN(when.getTime())) {
      node.textContent = "";
      return;
    }
    node.textContent = "更新於 " + formatClock(when) + "（香港時間）";
  }

  function renderItem(item) {
    var li = document.createElement("li");
    li.className = "item";

    var headline = document.createElement("h3");
    headline.className = "headline";
    headline.textContent = item.headline.trim();
    li.appendChild(headline);

    if (typeof item.summary === "string" && item.summary.trim()) {
      var summary = document.createElement("p");
      summary.className = "summary";
      summary.textContent = item.summary.trim();
      li.appendChild(summary);
    }

    var meta = document.createElement("p");
    meta.className = "meta";
    var time = document.createElement("time");
    var when = parseHkt(item.time_hkt);
    if (typeof item.time_hkt === "string" && !Number.isNaN(when.getTime())) {
      time.dateTime = item.time_hkt.trim();
      var label = relativeLabel(when, new Date());
      var absolute = formatAbsolute(when);
      time.textContent = label;
      time.title = absolute;
      time.setAttribute("aria-label", label + "（" + absolute + "）");
    } else {
      time.textContent = "時間不詳";
    }
    meta.appendChild(time);

    var sources = validSources(item.sources);
    if (sources.length) {
      var list = document.createElement("span");
      list.className = "sources";
      sources.forEach(function (source, index) {
        if (index > 0) {
          var sep = document.createElement("span");
          sep.className = "sep";
          sep.setAttribute("aria-hidden", "true");
          sep.textContent = "·";
          list.appendChild(sep);
        }
        var link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = source.name;
        list.appendChild(link);
      });
      meta.appendChild(list);
    }

    li.appendChild(meta);
    return li;
  }

  function fillColumn(id, items, emptyText) {
    var section = document.getElementById(id);
    var list = section.querySelector(".items");
    var empty = section.querySelector(".empty");
    list.replaceChildren();
    if (!items || !items.length) {
      empty.hidden = false;
      empty.textContent = emptyText || "暫無摘要";
      return;
    }
    empty.hidden = true;
    var fragment = document.createDocumentFragment();
    items.forEach(function (item) {
      fragment.appendChild(renderItem(item));
    });
    list.appendChild(fragment);
  }

  function fillAll(message) {
    SECTIONS.forEach(function (id) {
      fillColumn(id, [], message);
    });
  }

  function renderDigest(data) {
    var byId = {};
    var sections = data && Array.isArray(data.sections) ? data.sections : [];
    sections.forEach(function (section) {
      if (section && typeof section.id === "string") byId[section.id] = section;
    });
    SECTIONS.forEach(function (id) {
      var section = byId[id];
      var items = section && Array.isArray(section.items) ? section.items : [];
      fillColumn(id, items, "暫無摘要");
    });
    setUpdated(data && data.updatedAt);
  }

  function refreshTimes() {
    var now = new Date();
    var nodes = document.querySelectorAll(".item time[datetime]");
    for (var i = 0; i < nodes.length; i++) {
      var label = relativeLabel(nodes[i].dateTime, now);
      var when = parseHkt(nodes[i].dateTime);
      var absolute = Number.isNaN(when.getTime()) ? "" : formatAbsolute(when);
      nodes[i].textContent = label;
      if (absolute) {
        nodes[i].title = absolute;
        nodes[i].setAttribute("aria-label", label + "（" + absolute + "）");
      }
    }
  }

  function fillSelect(dates, active, today) {
    var select = document.getElementById("dateSelect");
    var seen = {};
    (Array.isArray(dates) ? dates : []).forEach(function (date) {
      if (isIsoDate(date)) seen[date] = true;
    });
    if (isIsoDate(active)) seen[active] = true;
    var sorted = Object.keys(seen).sort(function (a, b) {
      return a < b ? 1 : a > b ? -1 : 0;
    });
    select.replaceChildren();
    if (!sorted.length) {
      var empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "未有日期";
      select.appendChild(empty);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    sorted.forEach(function (date) {
      var option = document.createElement("option");
      option.value = date;
      var dayText = new Intl.DateTimeFormat("zh-Hant-HK", {
        timeZone: HKT,
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(parseHkt(date + "T12:00:00+08:00"));
      option.textContent = date === today ? dayText + "（今日）" : formatDateLabel(date);
      if (date === active) option.selected = true;
      select.appendChild(option);
    });
  }

  async function loadDates() {
    try {
      var response = await fetch(dataUrl("dates.json"), { cache: "no-cache" });
      if (!response.ok) return [];
      var data = await response.json();
      var list = Array.isArray(data) ? data : data && data.dates;
      return Array.isArray(list) ? list.filter(isIsoDate) : [];
    } catch (err) {
      return [];
    }
  }

  function emptyWindowMessage(date, today) {
    return date === today ? "過去 24 小時尚未有摘要。" : "這段時間尚未有摘要。";
  }

  async function fetchHour(slot) {
    try {
      var response = await fetch(dataUrl(slot.date + "/" + slot.hour + ".json"), { cache: "no-cache" });
      if (response.status === 404) return { missing: true };
      if (!response.ok) return { error: true };
      return { data: await response.json() };
    } catch (err) {
      return { error: true };
    }
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer === null) return;
    window.clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  function isViewingToday() {
    return isIsoDate(activeDate) && activeDate === hktDateString(new Date());
  }

  function scheduleAutoRefresh() {
    stopAutoRefresh();
    if (typeof document !== "undefined" && document.hidden) return;
    if (!isViewingToday()) return;
    autoRefreshTimer = window.setTimeout(function () {
      autoRefreshTimer = null;
      if (typeof document !== "undefined" && document.hidden) return;
      if (!isViewingToday()) return;
      autoRefreshToday();
    }, AUTO_REFRESH_MS);
  }

  // Silent re-fetch of the selected today view. Keeps the current board until
  // the new digest renders, then arms the next 30-minute tick.
  function autoRefreshToday() {
    var today = hktDateString(new Date());
    if (typeof document !== "undefined" && document.hidden) return;
    if (activeDate !== today) {
      stopAutoRefresh();
      return;
    }
    var generation = ++autoRefreshGeneration;
    lastRefreshAt = Date.now();
    scheduleAutoRefresh();
    return loadDigest(today, today, { silent: true }).then(afterSilentRefresh, afterSilentRefresh);

    function afterSilentRefresh() {
      if (generation !== autoRefreshGeneration) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (!isViewingToday()) return;
      if (autoRefreshTimer === null) scheduleAutoRefresh();
    }
  }

  function onVisibilityChange() {
    if (document.hidden) {
      stopAutoRefresh();
      return;
    }
    var onToday = isViewingToday();
    var elapsed = lastRefreshAt > 0 && Date.now() - lastRefreshAt >= AUTO_REFRESH_MS;
    // Catch up if the 30-minute interval elapsed or this visible view is
    // today. Historical dates stay idle: no auto fetch, no resumed timer.
    if ((elapsed || onToday) && onToday) autoRefreshToday();
  }

  async function loadDigest(date, today, options) {
    var silent = !!(options && options.silent);
    var serial = ++requestSerial;
    var now = new Date();
    var end = windowEndFor(date, today, now);
    var start = new Date(end.getTime() - WINDOW_MS);

    if (!silent) {
      autoRefreshGeneration += 1;
      activeDate = date;
      document.getElementById("dateline").textContent = isIsoDate(date)
        ? formatDateLabel(date)
        : "香港時間";
      setStatus("");
      setUpdated("");
      fillAll("載入中…");
      if (date === today) {
        lastRefreshAt = Date.now();
        scheduleAutoRefresh();
      } else {
        stopAutoRefresh();
      }
    }

    var slots = hourSlots(start, end);
    var results = await Promise.all(slots.map(fetchHour));
    if (serial !== requestSerial) return;

    var digests = [];
    var hardError = false;
    results.forEach(function (result) {
      if (result && result.data) digests.push(result.data);
      else if (result && result.error) hardError = true;
    });

    if (!digests.length) {
      if (hardError) {
        if (silent) return;
        fillAll("暫時未能載入");
        setStatus("暫時讀取不到摘要，請稍後再試。");
        return;
      }
      fillAll("暫無摘要");
      setStatus(emptyWindowMessage(date, today));
      setUpdated("");
      return;
    }

    var merged = mergeDigests(digests, start, end);
    renderDigest(merged);
    var any = merged.sections.some(function (section) {
      return section.items.length > 0;
    });
    if (!any) setStatus(emptyWindowMessage(date, today));
    else if (silent) setStatus("");
  }

  // Chips are <a href="#id"> inside .nav-inner { overflow-x: auto }, under a
  // position: sticky bar. iOS WebKit (Chrome and Safari) resolves that fragment
  // against the chip row, which does not contain the columns, so the tap does
  // not move the page. Desktop Chromium scrolls the document, and the bar is
  // hidden from 1080px up. Scroll the document to the column instead, using the
  // column's scroll-margin-top so the title clears the bar.
  function scrollColumnIntoView(section) {
    var margin = parseFloat(window.getComputedStyle(section).scrollMarginTop) || 0;
    var top = section.getBoundingClientRect().top + window.scrollY - margin;
    window.scrollTo(0, top < 0 ? 0 : top);
  }

  function bindSectionNav() {
    var nav = document.querySelector(".section-nav");
    if (!nav) return;
    nav.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var source = event.target;
      var link = source && source.closest ? source.closest("a") : null;
      if (!link || !nav.contains(link)) return;
      var href = link.getAttribute("href") || "";
      if (href.charAt(0) !== "#") return;
      var id = href.slice(1);
      if (SECTIONS.indexOf(id) === -1) return;
      var section = document.getElementById(id);
      if (!section) return;
      event.preventDefault();
      // Record the entry before scrolling so Back restores the previous
      // position instead of leaving the page. pushState does not scroll,
      // unlike assigning location.hash (which re-enters the broken iOS path).
      if (window.location.hash !== href) {
        var next = new URL(window.location.href);
        next.hash = href;
        history.pushState(history.state, "", next.href);
      }
      scrollColumnIntoView(section);
    });
  }

  function boot() {
    var today = hktDateString(new Date());
    var active = dateFromQuery() || today;
    var select = document.getElementById("dateSelect");
    activeDate = active;

    bindSectionNav();
    fillSelect([], active, today);
    var datesPromise = loadDates();
    loadDigest(active, today).then(function () {
      return datesPromise;
    }).then(function (dates) {
      fillSelect(dates, dateFromQuery() || today, hktDateString(new Date()));
    });

    select.addEventListener("change", function () {
      var date = select.value;
      if (!isIsoDate(date)) return;
      var url = new URL(window.location.href);
      url.searchParams.set("date", date);
      history.pushState({ date: date }, "", url);
      loadDigest(date, hktDateString(new Date()));
    });

    document.addEventListener("visibilitychange", onVisibilityChange);

    window.addEventListener("popstate", function () {
      var date = dateFromQuery() || hktDateString(new Date());
      // Hash-only history entries (category chips) must not refetch. The
      // browser restores the scroll position for that entry.
      if (select.value === date) return;
      var currentToday = hktDateString(new Date());
      fillSelect(
        Array.prototype.map.call(select.options, function (option) {
          return option.value;
        }),
        date,
        currentToday
      );
      loadDigest(date, currentToday);
    });

    window.setInterval(refreshTimes, 30000);
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      isIsoDate: isIsoDate,
      hktDateString: hktDateString,
      parseHkt: parseHkt,
      relativeLabel: relativeLabel,
      validSources: validSources,
      windowEndFor: windowEndFor,
      hourSlots: hourSlots,
      mergeDigests: mergeDigests,
    };
  }
})();
