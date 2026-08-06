(() => {
  const STORAGE_KEY = "restock_app_v1";
  const DEFAULTS_VERSION = 2;
  const DEFAULT_DEPARTMENTS = [
    { id: "dept-default-021-022", name: "Matériaux / Lumber", codes: ["021", "022"], aliases: ["Matériaux", "Lumber"] },
    { id: "dept-default-023", name: "Couvre-plancher", codes: ["023"], aliases: [] },
    { id: "dept-default-024", name: "Peinture", codes: ["024"], aliases: [] },
    { id: "dept-default-025", name: "Quincaillerie", codes: ["025"], aliases: [] },
    { id: "dept-default-026", name: "Plomberie", codes: ["026"], aliases: [] },
    { id: "dept-default-027", name: "Électricité", codes: ["027"], aliases: [] },
    { id: "dept-default-028", name: "Saisonnier", codes: ["028"], aliases: ["Jardinage"] },
    { id: "dept-default-029", name: "Cuisine et salle de bain", codes: ["029"], aliases: [] },
    { id: "dept-default-030", name: "Menuiserie", codes: ["030"], aliases: [] },
    { id: "dept-default-031", name: "Services spéciaux", codes: ["031"], aliases: [] },
    { id: "dept-default-070", name: "Électroménagers", codes: ["070"], aliases: [] },
    { id: "dept-default-078", name: "Location d'outils", codes: ["078"], aliases: [] }
  ];

  function normalize(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("fr-CA");
  }

  function randomId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function namedEntry(name) {
    return { id: randomId(), name, updatedAt: new Date().toISOString() };
  }

  function freshState() {
    const now = new Date().toISOString();
    return {
      version: 1,
      lists: [namedEntry("Tournée principale"), namedEntry("Urgences")],
      departments: DEFAULT_DEPARTMENTS.map(definition => ({
        id: definition.id,
        name: definition.name,
        codes: [...definition.codes],
        updatedAt: now
      })),
      employees: [],
      items: [],
      pickupLists: [],
      history: [],
      deletedIds: [],
      deletedListIds: [],
      deletedDepartmentIds: [],
      deletedEmployeeIds: [],
      deletedPickupListIds: [],
      settings: { storeName: "Mon magasin", keepPhotos: false },
      meta: { updatedAt: now, lastSyncAt: null, departmentDefaultsVersion: DEFAULTS_VERSION }
    };
  }

  function migrate(snapshot) {
    if (!snapshot || snapshot.version !== 1) return freshState();
    if (Number(snapshot.meta?.departmentDefaultsVersion || 0) >= DEFAULTS_VERSION) return snapshot;

    const now = new Date().toISOString();
    const departments = Array.isArray(snapshot.departments)
      ? snapshot.departments.filter(entry => entry?.id && String(entry.name || "").trim()).map(entry => ({ ...entry }))
      : [];
    const items = Array.isArray(snapshot.items) ? snapshot.items.map(item => ({ ...item })) : [];
    const deletedIds = new Set(Array.isArray(snapshot.deletedDepartmentIds) ? snapshot.deletedDepartmentIds : []);

    for (const definition of DEFAULT_DEPARTMENTS) {
      const names = new Set([definition.name, ...definition.aliases].map(normalize));
      const matches = departments
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => names.has(normalize(entry.name)));

      let target;
      const canonical = matches.find(({ entry }) => normalize(entry.name) === normalize(definition.name));
      if (canonical) target = canonical.entry;
      else if (matches.length) target = matches[0].entry;
      else {
        let id = definition.id;
        if (departments.some(entry => entry.id === id)) id = `${definition.id}-${randomId()}`;
        target = { id, name: definition.name, codes: [...definition.codes], updatedAt: now };
        departments.push(target);
      }

      target.name = definition.name;
      target.codes = [...definition.codes];
      target.updatedAt = now;
      deletedIds.delete(target.id);

      for (const { entry } of matches) {
        if (entry.id === target.id) continue;
        for (const item of items) {
          if (item.departmentId === entry.id) item.departmentId = target.id;
        }
        const index = departments.findIndex(candidate => candidate.id === entry.id);
        if (index >= 0) departments.splice(index, 1);
        deletedIds.add(entry.id);
      }
    }

    return {
      ...snapshot,
      departments,
      items,
      deletedDepartmentIds: [...deletedIds],
      meta: {
        ...(snapshot.meta || {}),
        updatedAt: now,
        departmentDefaultsVersion: DEFAULTS_VERSION
      }
    };
  }

  try {
    const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    const migrated = migrate(current);
    if (JSON.stringify(current) !== JSON.stringify(migrated)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(freshState()));
  }
})();
