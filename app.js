(function () {
  "use strict";

  var HKT = "Asia/Hong_Kong";
  var SECTIONS = ["local", "international", "finance-global", "finance-hk", "tech"];
  var MAX_ITEMS = 10;
  var requestSerial = 0;

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

  function prepareItems(items) {
    var list = (Array.isArray(items) ? items : []).filter(function (item) {
      return item && typeof item.headline === "string" && item.headline.trim();
    });
    list.sort(function (a, b) {
      var ra = Number(a.rank);
      var rb = Number(b.rank);
      var aOk = Number.isFinite(ra);
      var bOk = Number.isFinite(rb);
      if (aOk && bOk && ra !== rb) return ra - rb;
      if (aOk && !bOk) return -1;
      if (!aOk && bOk) return 1;
      return 0;
    });
    return list.slice(0, MAX_ITEMS);
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
      var items = section ? prepareItems(section.items) : [];
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

  async function loadDigest(date, today) {
    var serial = ++requestSerial;
    var dateline = document.getElementById("dateline");
    dateline.textContent = isIsoDate(date) ? formatDateLabel(date) : "香港時間";
    setStatus("");
    setUpdated("");
    fillAll("載入中…");

    try {
      var response = await fetch(dataUrl(date + ".json"), { cache: "no-cache" });
      if (serial !== requestSerial) return;
      if (response.status === 404) {
        fillAll("暫無摘要");
        setStatus(date === today ? "今日尚未有摘要。" : "這一日尚未有摘要。");
        return;
      }
      if (!response.ok) throw new Error("status " + response.status);
      var data = await response.json();
      if (serial !== requestSerial) return;
      renderDigest(data);
    } catch (err) {
      if (serial !== requestSerial) return;
      fillAll("暫時未能載入");
      setStatus("暫時讀取不到摘要，請稍後再試。");
    }
  }

  function boot() {
    var today = hktDateString(new Date());
    var active = dateFromQuery() || today;
    var select = document.getElementById("dateSelect");

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

    window.addEventListener("popstate", function () {
      var date = dateFromQuery() || hktDateString(new Date());
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
      prepareItems: prepareItems,
      validSources: validSources,
    };
  }
})();
