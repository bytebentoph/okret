// The shop around the rail: catalogue grid (#shop), menu, add to cart from the product view, and a cart
// drawer with a demo checkout. The cart lives in localStorage (per browser); no payment is taken.
(() => {
  const garments = window.OKRET.garments;
  const C = window.OKRET_CATALOG;
  const $ = (id) => document.getElementById(id);
  const byId = Object.fromEntries(garments.map((g) => [g.id, g]));
  const product = (id) => ({ ...byId[id], ...C.products[id] });
  const money = (n) => `${C.currency}${n.toFixed(n % 1 ? 2 : 0)}`;
  const img = (g, side) => `assets/garments/${g.id}/${side}.webp${window.ASSET_V ? `?v=${window.ASSET_V}` : ""}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const store = {   // localStorage can be blocked (private windows, previews): the page must work without it
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ---------- cart state ----------
  let cart = store.get("okret.cart", []).filter((l) => C.products[l.id] && C.sizes.includes(l.size));
  const save = () => { store.set("okret.cart", cart); renderCount(); };
  const count = () => cart.reduce((n, l) => n + l.qty, 0);
  const subtotal = () => cart.reduce((n, l) => n + l.qty * C.products[l.id].price, 0);
  const shippingFor = (sub) => (sub === 0 || sub >= C.shipping.freeOver ? 0 : C.shipping.flat);
  function add(id, size, qty = 1) {
    const line = cart.find((l) => l.id === id && l.size === size);
    if (line) line.qty = Math.min(line.qty + qty, 9); else cart.push({ id, size, qty });
    save();
  }
  function setQty(id, size, qty) {
    cart = qty > 0 ? cart.map((l) => (l.id === id && l.size === size ? { ...l, qty: Math.min(qty, 9) } : l))
                   : cart.filter((l) => !(l.id === id && l.size === size));
    save();
  }
  function renderCount() {
    const n = count(), el = $("cartCount");
    el.textContent = n; el.hidden = n === 0;
    $("cartOpen").setAttribute("aria-label", `Cart, ${n} item${n === 1 ? "" : "s"}`);
  }

  // ---------- toast ----------
  let toastTimer = 0;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg; t.classList.add("is-on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("is-on"), 2200);
  }

  // ---------- drawers (menu, cart) ----------
  let openDrawer = null, returnFocus = null;
  function showDrawer(el) {
    if (openDrawer && openDrawer !== el) hideDrawer(false);
    returnFocus = document.activeElement;
    el.hidden = false; $("scrim").hidden = false;
    requestAnimationFrame(() => { el.classList.add("is-open"); $("scrim").classList.add("is-on"); });
    document.body.classList.add("has-drawer");
    $(el.id === "cart" ? "cartOpen" : "menuOpen").setAttribute("aria-expanded", "true");
    openDrawer = el;
    el.querySelector("[data-close]").focus();
  }
  function hideDrawer(restore = true) {
    const el = openDrawer;
    if (!el) return;
    el.classList.remove("is-open"); $("scrim").classList.remove("is-on");
    $(el.id === "cart" ? "cartOpen" : "menuOpen").setAttribute("aria-expanded", "false");
    document.body.classList.remove("has-drawer");
    openDrawer = null;
    setTimeout(() => { if (openDrawer !== el) el.hidden = true; if (!openDrawer) $("scrim").hidden = true; }, 350);
    if (restore) returnFocus?.focus?.({ preventScroll: true });
  }
  document.querySelectorAll(".drawer [data-close]").forEach((b) => b.addEventListener("click", () => hideDrawer()));
  $("scrim").addEventListener("click", () => hideDrawer());
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openDrawer) { e.stopPropagation(); hideDrawer(); } }, true);

  // ---------- menu ----------
  function renderMenu() {
    const links = [["#", "The rail"], ["#shop", "Shop all"], ...C.categories.map((c) => [`#shop/${c.id}`, c.name])];
    $("menuNav").innerHTML = links.map(([href, name]) => `<a class="menu__link" href="${href}">${name}</a>`).join("") +
      `<p class="menu__note muted">Okret / Collection 01</p>`;
  }
  $("menuNav").addEventListener("click", (e) => { if (e.target.closest("a")) hideDrawer(false); });
  $("menuOpen").addEventListener("click", () => showDrawer($("menu")));

  // ---------- catalogue ----------
  let cols = store.get("okret.cols", 3);
  function renderShop(cat) {
    const list = garments.filter((g) => C.products[g.id] && (!cat || C.products[g.id].category === cat));
    $("shopFilters").innerHTML = [["", "All"], ...C.categories.map((c) => [c.id, c.name])]
      .map(([id, name]) => `<a href="#shop${id ? "/" + id : ""}" class="chip"${(cat || "") === id ? ' aria-current="page"' : ""}>${name}</a>`).join("");
    $("shopCount").textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;
    $("shopGrid").innerHTML = list.map((g) => {
      const p = product(g.id);
      return `<li><button class="card" type="button" data-id="${g.id}" aria-label="${esc(p.name)}, ${esc(p.type)}, ${money(p.price)}">
        <span class="card__media">
          <img class="card__img" src="${img(g, "front")}" alt="" loading="lazy">
          <img class="card__img card__img--back" src="${img(g, "back")}" alt="" loading="lazy">
        </span>
        <span class="card__info">
          <span class="card__name">${esc(p.name)}</span><span class="card__price">${money(p.price)}</span>
          <span class="card__meta muted">${esc(p.type)} · ${esc(p.colour)}</span>
        </span></button></li>`;
    }).join("");
    setCols(cols);
  }
  function setCols(n) {
    cols = n; store.set("okret.cols", n);
    $("shopGrid").style.setProperty("--cols", n);
    document.querySelectorAll(".shop__grid-size button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.cols === n));
  }
  document.querySelectorAll(".shop__grid-size button").forEach((b) => b.addEventListener("click", () => setCols(+b.dataset.cols)));
  $("shopGrid").addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) window.OKRET.openDetail(card.dataset.id);
  });

  // ---------- routing: # = the rail, #shop[/category] = catalogue ----------
  function route() {
    const [view, cat] = location.hash.replace(/^#\/?/, "").split("/");
    const shop = view === "shop";
    $("shop").hidden = !shop;
    document.querySelector(".stage").hidden = shop;
    document.body.classList.toggle("is-shop", shop);
    if (shop) { renderShop(C.categories.some((c) => c.id === cat) ? cat : ""); $("shop").scrollTop = 0; }
    window.OKRET.closeDetail?.();
  }
  addEventListener("hashchange", route);

  // ---------- product view: price, copy, sizes, add to cart ----------
  let size = null, shownId = null;
  window.OKRET.onDetail = (g) => {
    const p = product(g.id);
    if (!p.price) { $("buy").innerHTML = ""; return; }
    if (g.id !== shownId) { size = null; shownId = g.id; }
    $("buy").innerHTML = `
      <p class="buy__price">${money(p.price)}</p>
      <p class="buy__copy muted">${esc(p.copy)}</p>
      <div class="buy__sizes" role="radiogroup" aria-label="Size">
        ${C.sizes.map((s) => `<button type="button" role="radio" class="size" data-size="${s}" aria-checked="${s === size}">${s}</button>`).join("")}
      </div>
      <button type="button" class="btn btn--primary buy__add" id="buyAdd">${size ? "Add to cart" : "Select a size"}</button>`;
  };
  $("buy").addEventListener("click", (e) => {
    const s = e.target.closest(".size");
    if (s) {
      size = s.dataset.size;
      $("buy").querySelectorAll(".size").forEach((b) => b.setAttribute("aria-checked", b === s));
      $("buyAdd").textContent = "Add to cart";
      return;
    }
    if (e.target.closest("#buyAdd")) {
      if (!size) { $("buy").querySelector(".buy__sizes").classList.remove("is-nudge"); void $("buy").offsetWidth;
                   $("buy").querySelector(".buy__sizes").classList.add("is-nudge"); return; }
      add(shownId, size);
      const p = product(shownId);
      toast(`${p.name} · ${size} added to cart`);
      const b = $("buyAdd"); b.innerHTML = `<svg class="icon icon--sm"><use href="#i-check"/></svg> Added`;
      setTimeout(() => { if ($("buyAdd") === b) b.textContent = "Add to cart"; }, 1400);
    }
  });

  // ---------- cart drawer: items -> checkout -> confirmation ----------
  let step = "items";
  function renderCart() {
    const body = $("cartBody"), foot = $("cartFoot");
    if (step === "done") return;
    if (!cart.length) {
      $("cartTitle").textContent = "Cart";
      body.innerHTML = `<div class="cart__empty"><p>Your cart is empty.</p><a class="btn" href="#shop" data-go>Shop the collection</a></div>`;
      foot.innerHTML = ""; step = "items"; return;
    }
    const sub = subtotal(), ship = shippingFor(sub), left = C.shipping.freeOver - sub;
    const lines = cart.map((l) => {
      const p = product(l.id);
      return `<li class="line" data-id="${l.id}" data-size="${l.size}">
        <img class="line__img" src="${img(byId[l.id], "front")}" alt="">
        <div class="line__info">
          <p class="line__name">${esc(p.name)} <span class="muted">· ${l.size}</span></p>
          <p class="line__meta muted">${esc(p.type)} · ${esc(p.colour)}</p>
          ${step === "items" ? `<div class="qty" aria-label="Quantity">
            <button type="button" data-q="-1" aria-label="One fewer"><svg class="icon icon--sm"><use href="#i-minus"/></svg></button>
            <span>${l.qty}</span>
            <button type="button" data-q="1" aria-label="One more"><svg class="icon icon--sm"><use href="#i-plus"/></svg></button>
          </div>` : `<p class="line__meta muted">Qty ${l.qty}</p>`}
        </div>
        <div class="line__end"><span>${money(l.qty * p.price)}</span>${step === "items" ? `<button type="button" class="line__remove" data-q="0">Remove</button>` : ""}</div>
      </li>`;
    }).join("");
    if (step === "items") {
      $("cartTitle").textContent = `Cart (${count()})`;
      body.innerHTML = `${left > 0 ? `<p class="cart__ship muted">${money(left)} away from free shipping</p>` : `<p class="cart__ship muted">Free shipping</p>`}
        <div class="cart__bar"><span style="width:${Math.min(100, (sub / C.shipping.freeOver) * 100)}%"></span></div>
        <ul class="cart__lines">${lines}</ul>`;
      foot.innerHTML = `${totals(sub, ship)}<button type="button" class="btn btn--primary btn--block" data-step="checkout">Checkout</button>`;
    } else {
      $("cartTitle").textContent = "Checkout";
      body.innerHTML = `<button type="button" class="cart__back" data-step="items"><svg class="icon icon--sm"><use href="#i-prev"/></svg> Back to cart</button>
        <ul class="cart__lines">${lines}</ul>
        <p class="cart__demo">This is a demo store: placing an order takes no payment and ships nothing.</p>`;
      foot.innerHTML = `${totals(sub, ship)}<button type="button" class="btn btn--primary btn--block" data-step="place">Place order · ${money(sub + ship)}</button>`;
    }
  }
  function totals(sub, ship) {
    return `<dl class="totals"><div><dt>Subtotal</dt><dd>${money(sub)}</dd></div>
      <div><dt>Shipping</dt><dd>${ship ? money(ship) : "Free"}</dd></div>
      <div class="totals__sum"><dt>Total</dt><dd>${money(sub + ship)}</dd></div></dl>`;
  }
  function placeOrder() {
    const n = count(), total = subtotal() + shippingFor(subtotal());
    const no = `OK-${Date.now().toString(36).toUpperCase().slice(-6)}`;
    cart = []; save(); step = "done";
    $("cartTitle").textContent = "Order placed";
    $("cartBody").innerHTML = `<div class="cart__done"><span class="cart__tick"><svg class="icon"><use href="#i-check"/></svg></span>
      <p class="cart__done-title">Thank you.</p>
      <p class="muted">Order ${no} · ${n} item${n === 1 ? "" : "s"} · ${money(total)}</p>
      <p class="cart__demo">Demo order: no payment was taken.</p></div>`;
    $("cartFoot").innerHTML = `<a class="btn btn--block" href="#shop" data-go>Continue shopping</a>`;
  }
  $("cart").addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]");
    if (q) {
      const line = q.closest(".line"), l = cart.find((x) => x.id === line.dataset.id && x.size === line.dataset.size);
      setQty(l.id, l.size, +q.dataset.q === 0 ? 0 : l.qty + +q.dataset.q);
      renderCart(); return;
    }
    const s = e.target.closest("[data-step]");
    if (s) { if (s.dataset.step === "place") placeOrder(); else { step = s.dataset.step; renderCart(); } return; }
    if (e.target.closest("[data-go]")) { step = "items"; hideDrawer(false); }
  });
  $("cartOpen").addEventListener("click", () => {
    if (step === "done") step = "items";
    renderCart(); showDrawer($("cart"));
  });

  renderMenu();
  renderCount();
  route();
})();
