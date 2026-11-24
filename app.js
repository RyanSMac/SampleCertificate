    (() => {
      const databaseName = "mae-sampling-certificate";
      const databaseVersion = 1;
      const draftKey = "working";
      const legacyDraftKey = "mae-sampling-certificate-v1";
      const legacyPhotoKey = legacyDraftKey + "-photo";
      const labTests = [
        "Bitumen content", "BS EN Grading", "BS Grading", "Chemical Suite",
        "Class Ra (asphalt content)", "Constituents of coarse recycled aggregates", "Frost Heave", "IDD of chalk",
        "Los Angeles Coefficient", "Magnesium Sulphate Soundness", "Moisture Condition Value", "Moisture Content",
        "Optimum Moisture Content", "Optimum Moisture Content (Vib. Hammer)", "Permeability", "Ph Value",
        "Plasticity Index", "Redox Potential", "Shear Box", "Slake Durability",
        "Sulphate Testing (Water Soluble Sulphate)", "Sulphide Content", "Topsoil Suite", "Total Sulphur",
        "Undrained shear parameters", "Undrained shear strength", "Uniformity Coefficient", "Water Absorption", "Water Content"
      ];
      const siteTests = [
        "CBR Plate Load Testing", "Cyclic Plate Load Testing", "Dynamic Cone Pentrometer (DCP) / CBR",
        "Field Dry Density", "Light Weight Deflectometer (LWD)", "Plate CBR", "Static plate load test"
      ];
      const form = document.getElementById("certificate");
      const status = document.getElementById("save-state");
      const archivePanel = document.getElementById("archive-panel");
      const archiveList = document.getElementById("archive-list");
      const archiveStatus = document.getElementById("archive-status");
      const archiveSearch = document.getElementById("archive-search");
      const photoInput = document.getElementById("photo-upload");
      const photoPreview = document.getElementById("photo-preview");
      const photoPreviewImage = document.getElementById("photo-preview-image");
      const photoName = document.getElementById("photo-name");
      const archiveViewBanner = document.getElementById("archive-view-banner");
      let database = null;
      let currentPhoto = null;
      let currentMode = "draft";
      let activeArchiveRecord = null;
      let lastDraftSnapshot = null;
      let nextTestId = 0;
      let saveTimer = null;

      function renderTestingSectionMarkup(config) {
        const container = document.getElementById("testing-sections");
        const section = document.createElement("section");
        section.className = "section testing-section";
        section.id = config.key + "-testing";
        section.setAttribute("aria-labelledby", config.key + "-tests-title");
        section.innerHTML = `
          <h2 class="section-heading" id="${config.key}-tests-title">${config.title} <span class="test-count" id="${config.key}-test-count">(0)</span></h2>
          <p class="test-intro">${config.intro}</p>
          <div class="test-picker">
            <label for="${config.key}-test-search">${config.searchLabel}</label>
            <input id="${config.key}-test-search" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${config.key}-test-options" aria-describedby="${config.key}-test-validation" placeholder="${config.placeholder}" autocomplete="off">
            <span class="search-icon" aria-hidden="true">⌕</span>
            <div class="test-options" id="${config.key}-test-options" role="listbox" hidden></div>
            <p class="test-validation" id="${config.key}-test-validation" role="status" aria-live="polite"></p>
            <button class="add-test-button" id="add-${config.key}-test" type="button">${config.addLabel}</button>
          </div>
          <h3 class="selected-tests-title">Selected Tests</h3>
          <table class="test-table">
            <thead><tr><th scope="col">Test / Method</th><th scope="col">Comments</th><th scope="col">Actions</th></tr></thead>
            <tbody id="${config.key}-test-rows" data-test-list="${config.key}"></tbody>
          </table>`;
        container.appendChild(section);
      }

      const sectionDefinitions = [
        {
          key: "lab",
          storageKey: "laboratoryTests",
          title: "Laboratory Testing",
          intro: "Add the laboratory testing required for this sample.",
          searchLabel: "Search and select laboratory test",
          placeholder: "Search laboratory tests…",
          addLabel: "Add Laboratory Test",
          tests: labTests
        },
        {
          key: "site",
          storageKey: "siteTests",
          title: "Site Testing",
          intro: "Add the site testing required for this sample.",
          searchLabel: "Search and select site test",
          placeholder: "Search site tests…",
          addLabel: "Add Site Test",
          tests: siteTests
        }
      ];
      sectionDefinitions.forEach(renderTestingSectionMarkup);
      const testingSections = [
        ...sectionDefinitions.map((definition) => ({
          ...definition,
          rows: document.getElementById(definition.key + "-test-rows"),
          search: document.getElementById(definition.key + "-test-search"),
          options: document.getElementById(definition.key + "-test-options"),
          addButton: document.getElementById("add-" + definition.key + "-test"),
          count: document.getElementById(definition.key + "-test-count"),
          validation: document.getElementById(definition.key + "-test-validation"),
          selected: [],
          activeIndex: -1
        }))
      ];

      function openDatabase() {
        return new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseName, databaseVersion);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains("drafts")) {
              db.createObjectStore("drafts", { keyPath: "id" });
            }
            if (!db.objectStoreNames.contains("archives")) {
              db.createObjectStore("archives", { keyPath: "id" });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("Could not open offline storage."));
          request.onblocked = () => reject(new Error("Offline storage is blocked by another open app tab. Close other tabs and reload."));
        });
      }

      function runTransaction(storeName, mode, action) {
        return new Promise((resolve, reject) => {
          if (!database) {
            reject(new Error("Offline storage is unavailable."));
            return;
          }
          let transaction;
          try {
            transaction = database.transaction(storeName, mode);
          } catch (error) {
            reject(error);
            return;
          }
          let result;
          let requestError = null;
          transaction.oncomplete = () => resolve(result);
          transaction.onabort = () => reject(requestError || transaction.error || new Error("Offline storage transaction was aborted."));
          transaction.onerror = () => {
            requestError = transaction.error || new Error("Offline storage transaction failed.");
          };
          try {
            const request = action(transaction.objectStore(storeName));
            if (request) {
              request.onsuccess = () => { result = request.result; };
              request.onerror = () => { requestError = request.error || new Error("Offline storage request failed."); };
            }
          } catch (error) {
            requestError = error;
            transaction.abort();
          }
        });
      }

      const getDraftRecord = () => runTransaction("drafts", "readonly", (store) => store.get(draftKey));
      const putDraftRecord = (record) => runTransaction("drafts", "readwrite", (store) => store.put(record));
      const deleteDraftRecord = () => runTransaction("drafts", "readwrite", (store) => store.delete(draftKey));
      const getArchiveRecords = () => runTransaction("archives", "readonly", (store) => store.getAll());
      const getArchiveRecord = (id) => runTransaction("archives", "readonly", (store) => store.get(id));
      const deleteArchiveRecord = (id) => runTransaction("archives", "readwrite", (store) => store.delete(id));

      function createArchiveId() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
        return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + (++nextTestId).toString(36);
      }

      function setArchiveStatus(message, isError) {
        archiveStatus.textContent = message;
        archiveStatus.classList.toggle("error", Boolean(isError));
      }

      function setView(mode) {
        currentMode = mode;
        const viewingRecord = mode === "record";
        const viewingList = mode === "archive";
        form.hidden = viewingList;
        archivePanel.hidden = !viewingList;
        archiveViewBanner.hidden = !viewingRecord;
        form.classList.toggle("archive-readonly", viewingRecord);
        document.getElementById("open-archive").hidden = mode !== "draft";
        document.getElementById("save-to-archive").hidden = mode !== "draft";
        document.getElementById("clear-form").hidden = mode !== "draft";
        document.getElementById("return-to-archive").hidden = !viewingRecord;
        document.getElementById("new-from-archive").hidden = !viewingRecord;
        document.getElementById("print-form").hidden = viewingList;
        form.querySelectorAll("input, select, textarea, button").forEach((control) => {
          control.disabled = viewingRecord;
        });
        if (!viewingRecord) {
          form.querySelectorAll("input, select, textarea, button").forEach((control) => {
            control.disabled = false;
          });
        }
      }

      function setTestValidation(section, message) {
        section.validation.textContent = message;
        section.search.setAttribute("aria-invalid", message ? "true" : "false");
      }

      function closeTestOptions(section) {
        section.options.hidden = true;
        section.search.setAttribute("aria-expanded", "false");
        section.search.removeAttribute("aria-activedescendant");
        section.activeIndex = -1;
      }

      function renderTestOptions(section) {
        const query = section.search.value.trim().toLocaleLowerCase();
        const selected = new Set(section.selected.map((item) => item.test));
        const matches = section.tests.filter((test) =>
          !selected.has(test) && test.toLocaleLowerCase().includes(query)
        );
        section.options.replaceChildren();
        section.activeIndex = -1;
        section.search.removeAttribute("aria-activedescendant");
        section.search.setAttribute("aria-expanded", "true");
        section.options.hidden = false;

        if (matches.length === 0) {
          const empty = document.createElement("div");
          empty.className = "no-test-results";
          empty.textContent = "No matching tests found.";
          empty.setAttribute("role", "status");
          section.options.appendChild(empty);
          return;
        }

        matches.forEach((test, index) => {
          const option = document.createElement("button");
          option.type = "button";
          option.className = "test-option";
          option.id = section.key + "-test-option-" + index;
          option.setAttribute("role", "option");
          option.setAttribute("aria-selected", "false");
          option.textContent = test;
          option.addEventListener("mousedown", (event) => event.preventDefault());
          option.addEventListener("click", () => addSelectedTest(section, test));
          section.options.appendChild(option);
        });
      }

      function setActiveTestOption(section, index) {
        const options = section.options.querySelectorAll('[role="option"]');
        if (options.length === 0) return;
        section.activeIndex = (index + options.length) % options.length;
        options.forEach((option, optionIndex) => {
          const active = optionIndex === section.activeIndex;
          option.setAttribute("aria-selected", active ? "true" : "false");
          if (active) {
            section.search.setAttribute("aria-activedescendant", option.id);
            option.scrollIntoView({ block: "nearest" });
          }
        });
      }

      function renderSelectedTests(section) {
        section.rows.replaceChildren();
        section.count.textContent = "(" + section.selected.length + ")";
        if (section.selected.length === 0) {
          const row = document.createElement("tr");
          const cell = document.createElement("td");
          cell.className = "empty-tests";
          cell.colSpan = 3;
          cell.textContent = "No tests selected yet.";
          row.appendChild(cell);
          section.rows.appendChild(row);
          return;
        }

        section.selected.forEach((item) => {
          const row = document.createElement("tr");
          row.className = "test-row";
          row.dataset.testId = item.id;

          const testCell = document.createElement("td");
          const testName = document.createElement("span");
          testName.className = "test-name";
          testName.textContent = item.test;
          testCell.appendChild(testName);

          const commentCell = document.createElement("td");
          const commentLabel = document.createElement("span");
          commentLabel.className = "test-card-label";
          commentLabel.textContent = "Comment";
          const comment = document.createElement("input");
          comment.className = "test-comment";
          comment.type = "text";
          comment.value = item.comment;
          comment.dataset.testComment = "";
          comment.setAttribute("aria-label", "Comments for " + item.test);
          commentCell.append(commentLabel, comment);

          const actionsCell = document.createElement("td");
          const actionLabel = document.createElement("span");
          actionLabel.className = "test-card-label";
          actionLabel.textContent = "Actions";
          const remove = document.createElement("button");
          remove.className = "remove-test";
          remove.type = "button";
          remove.textContent = "Remove";
          remove.setAttribute("aria-label", "Remove " + item.test);
          remove.addEventListener("click", () => {
            section.selected = section.selected.filter((selected) => selected.id !== item.id);
            renderSelectedTests(section);
            setTestValidation(section, "");
            saveForm();
          });
          actionsCell.append(actionLabel, remove);
          row.append(testCell, commentCell, actionsCell);
          section.rows.appendChild(row);
        });
      }

      function addSelectedTest(section, test) {
        if (!section.tests.includes(test)) {
          setTestValidation(section, "Select a test from the available results.");
          return;
        }
        if (section.selected.some((item) => item.test === test)) {
          setTestValidation(section, "This test is already selected.");
          renderTestOptions(section);
          return;
        }
        section.selected.push({ id: String(++nextTestId), test, comment: "" });
        section.search.value = "";
        closeTestOptions(section);
        setTestValidation(section, "");
        renderSelectedTests(section);
        saveForm();
        section.search.focus();
      }

      function initializeTestPicker(section) {
        section.search.addEventListener("focus", () => renderTestOptions(section));
        section.search.addEventListener("input", () => {
          setTestValidation(section, "");
          renderTestOptions(section);
        });
        section.search.addEventListener("keydown", (event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (section.options.hidden) renderTestOptions(section);
            const step = event.key === "ArrowDown" ? 1 : -1;
            const optionCount = section.options.querySelectorAll('[role="option"]').length;
            const nextIndex = section.activeIndex < 0
              ? (step > 0 ? 0 : optionCount - 1)
              : section.activeIndex + step;
            setActiveTestOption(section, nextIndex);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const options = section.options.querySelectorAll('[role="option"]');
            if (section.activeIndex >= 0 && options[section.activeIndex]) {
              addSelectedTest(section, options[section.activeIndex].textContent);
            } else {
              const exactMatch = Array.from(options).find((option) =>
                option.textContent.toLocaleLowerCase() === section.search.value.trim().toLocaleLowerCase()
              );
              if (exactMatch) {
                addSelectedTest(section, exactMatch.textContent);
              } else if (!section.options.hidden && section.options.querySelector('[role="option"]')) {
                setTestValidation(section, "Choose a test from the search results.");
              } else if (section.search.value.trim()) {
                setTestValidation(section, "No matching tests found.");
              } else {
                setTestValidation(section, "Search for and select a test first.");
              }
              if (!section.options.hidden) renderTestOptions(section);
            }
          } else if (event.key === "Escape") {
            closeTestOptions(section);
          }
        });
        section.addButton.addEventListener("click", () => {
          section.search.focus();
          renderTestOptions(section);
        });
        section.search.addEventListener("focusout", (event) => {
          if (!section.options.contains(event.relatedTarget) && event.relatedTarget !== section.addButton) {
            closeTestOptions(section);
          }
        });
        section.rows.addEventListener("input", (event) => {
          if (!event.target.matches(".test-comment")) return;
          const row = event.target.closest(".test-row");
          const item = section.selected.find((selected) => selected.id === row?.dataset.testId);
          if (item) {
            item.comment = event.target.value;
            saveForm();
          }
        });
        renderSelectedTests(section);
      }

      function restoreSelectedTests(section, data) {
        let savedTests = data[section.storageKey];
        if (!Array.isArray(savedTests)) {
          const legacyTests = [];
          const legacyTestPattern = new RegExp("^" + section.key + "Test(\\d+)$");
          const legacyIndexes = Object.keys(data)
            .map((key) => legacyTestPattern.exec(key))
            .filter(Boolean)
            .map((match) => Number(match[1]))
            .sort((left, right) => left - right);
          legacyIndexes.forEach((index) => {
            const test = data[section.key + "Test" + index];
            const comment = data[section.key + "Comment" + index];
            if (typeof test === "string" && test.trim()) {
              legacyTests.push({ test, comment: typeof comment === "string" ? comment : "" });
            }
          });
          savedTests = legacyTests;
        }
        const seen = new Set();
        section.selected = [];
        savedTests.forEach((item) => {
          if (!item || typeof item.test !== "string" || typeof item.comment !== "string") return;
          if (!section.tests.includes(item.test) || seen.has(item.test)) return;
          seen.add(item.test);
          section.selected.push({ id: String(++nextTestId), test: item.test, comment: item.comment });
        });
        renderSelectedTests(section);
      }

      function readForm() {
        const data = {};
        Array.from(form.elements).forEach((element) => {
          if (element.name && !element.hasAttribute("data-test-comment")) {
            data[element.name] = element.type === "checkbox" ? element.checked : element.value;
          }
        });
        testingSections.forEach((section) => {
          data[section.storageKey] = section.selected.map(({ test, comment }) => ({ test, comment }));
        });
        return data;
      }

      function populateForm(data, photo) {
        setView("draft");
        form.reset();
        testingSections.forEach((section) => {
          section.selected = [];
          section.search.value = "";
          closeTestOptions(section);
          setTestValidation(section, "");
        });
        Array.from(form.elements).forEach((element) => {
          if (!element.name || !Object.prototype.hasOwnProperty.call(data, element.name)) return;
          if (element.type === "checkbox") element.checked = data[element.name] === true;
          else if (typeof data[element.name] === "string") element.value = data[element.name];
        });
        testingSections.forEach((section) => restoreSelectedTests(section, data));
        showPhoto(photo);
      }

      function saveForm() {
        if (currentMode !== "draft") return;
        window.clearTimeout(saveTimer);
        status.textContent = "Saving draft…";
        saveTimer = window.setTimeout(() => { void persistDraftNow(); }, 250);
      }

      async function persistDraftNow() {
        if (currentMode !== "draft") return false;
        if (saveTimer !== null) {
          window.clearTimeout(saveTimer);
          saveTimer = null;
        }
        saveTimer = null;
        try {
          const record = {
            id: draftKey,
            updatedAt: new Date().toISOString(),
            data: readForm(),
            photo: currentPhoto
          };
          await putDraftRecord(record);
          lastDraftSnapshot = record;
          status.textContent = "Draft saved on this device";
          return true;
        } catch (error) {
          status.textContent = "Draft save failed: " + error.message;
          console.error("Unable to save the sampling certificate draft.", error);
          return false;
        }
      }

      function showPhoto(photo) {
        currentPhoto = photo && typeof photo.dataUrl === "string"
          ? { dataUrl: photo.dataUrl, name: typeof photo.name === "string" ? photo.name : "" }
          : null;
        photoPreviewImage.removeAttribute("src");
        if (!currentPhoto) {
          photoName.textContent = "";
          photoPreview.hidden = true;
          return;
        }
        photoPreviewImage.src = currentPhoto.dataUrl;
        photoName.textContent = currentPhoto.name || "Saved sample photograph";
        photoPreview.hidden = false;
      }

      function loadImage(file) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          const objectUrl = URL.createObjectURL(file);
          image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
          };
          image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("The selected file could not be read as an image."));
          };
          image.src = objectUrl;
        });
      }

      async function preparePhoto(file) {
        if (!file.type.startsWith("image/")) {
          throw new Error("Please choose an image file.");
        }
        const image = await loadImage(file);
        const maxDimension = 1600;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser could not prepare the selected photo.");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.82);
      }

      function readLegacyData() {
        const draftText = localStorage.getItem(legacyDraftKey);
        const photoText = localStorage.getItem(legacyPhotoKey);
        if (!draftText && !photoText) return null;
        const data = draftText ? JSON.parse(draftText) : {};
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("The existing saved draft has an invalid format; it was left untouched.");
        }
        const photo = photoText ? JSON.parse(photoText) : null;
        if (photoText && (!photo || typeof photo.dataUrl !== "string" || !photo.dataUrl.startsWith("data:image/"))) {
          throw new Error("The existing saved photo has an invalid format; it was left untouched.");
        }
        return { data, photo };
      }

      function removeLegacyStorage() {
        try {
          localStorage.removeItem(legacyDraftKey);
          localStorage.removeItem(legacyPhotoKey);
          return true;
        } catch (error) {
          console.error("Could not remove migrated legacy draft data.", error);
          status.textContent = "Draft migrated, but old local copies could not be removed: " + error.message;
          return false;
        }
      }

      async function initializeStorage() {
        try {
          database = await openDatabase();
          let draft = await getDraftRecord();
          let migrated = false;
          if (!draft) {
            const legacy = readLegacyData();
            if (legacy) {
              draft = {
                id: draftKey,
                updatedAt: new Date().toISOString(),
                data: legacy.data,
                photo: legacy.photo
              };
              await putDraftRecord(draft);
              migrated = true;
            }
          }
          lastDraftSnapshot = draft || { id: draftKey, data: {}, photo: null };
          populateForm(lastDraftSnapshot.data || {}, lastDraftSnapshot.photo || null);
          const legacyRemoved = draft ? removeLegacyStorage() : true;
          if (!legacyRemoved) {
            return;
          } else if (migrated) {
            status.textContent = "Existing draft and photo migrated to offline storage";
          } else if (draft) {
            status.textContent = "Draft restored from this device";
          } else {
            status.textContent = "Ready — working draft autosaves on this device";
          }
        } catch (error) {
          status.textContent = "Offline storage error: " + error.message;
          console.error("Unable to initialize offline certificate storage.", error);
          try {
            const legacy = readLegacyData();
            if (legacy) {
              lastDraftSnapshot = { id: draftKey, data: legacy.data, photo: legacy.photo };
              populateForm(legacy.data, legacy.photo);
              status.textContent = "Storage unavailable; legacy draft loaded but changes cannot be saved.";
            } else {
              populateForm({}, null);
            }
          } catch (legacyError) {
            status.textContent = "Offline storage error: " + error.message + " " + legacyError.message;
            populateForm({}, null);
          }
        } finally {
          form.removeAttribute("inert");
          document.querySelectorAll(".toolbar button, #export-archive, #import-archive-button").forEach((button) => {
            button.disabled = false;
          });
        }
      }

      function escapeText(value) {
        return typeof value === "string" ? value : "";
      }

      function formatSavedDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
      }

      function renderArchiveCards() {
        archiveList.replaceChildren();
        const query = archiveSearch.value.trim().toLocaleLowerCase();
        const matches = archiveRecords.filter((record) => {
          const date = new Date(record.savedAt);
          const searchText = [
            record.id,
            record.data.projectName,
            record.data.sampleNumber,
            record.savedAt,
            Number.isNaN(date.getTime()) ? "" : date.toLocaleString(),
            Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
          ].map(escapeText).join(" ").toLocaleLowerCase();
          return searchText.includes(query);
        });
        if (matches.length === 0) {
          const empty = document.createElement("div");
          empty.className = "archive-empty";
          empty.textContent = archiveRecords.length ? "No certificates match this search." : "No certificates saved yet.";
          archiveList.appendChild(empty);
          return;
        }
        matches.forEach((record) => {
          const card = document.createElement("article");
          card.className = "archive-card";
          const details = document.createElement("div");
          const title = document.createElement("h3");
          title.textContent = record.data.projectName || "Untitled project";
          const meta = document.createElement("p");
          meta.className = "archive-meta";
          meta.textContent = [
            "ID: " + record.id,
            "Sample: " + (record.data.sampleNumber || "Not specified"),
            "Saved: " + formatSavedDate(record.savedAt)
          ].join(" · ");
          details.append(title, meta);

          const actions = document.createElement("div");
          actions.className = "archive-card-actions";
          [
            ["open", "Open"],
            ["print", "Print"],
            ["new-draft", "Use as new draft"],
            ["delete", "Delete"]
          ].forEach(([action, label]) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.dataset.archiveAction = action;
            button.dataset.archiveId = record.id;
            if (action === "delete") button.className = "archive-delete";
            else button.className = "button-secondary";
            actions.appendChild(button);
          });
          card.append(details, actions);
          archiveList.appendChild(card);
        });
      }

      let archiveRecords = [];
      async function refreshArchive() {
        setArchiveStatus("Loading archive…", false);
        try {
          archiveRecords = await getArchiveRecords();
          renderArchiveCards();
          setArchiveStatus(archiveRecords.length + (archiveRecords.length === 1 ? " certificate saved on this device." : " certificates saved on this device."), false);
        } catch (error) {
          archiveRecords = [];
          archiveList.replaceChildren();
          setArchiveStatus("Could not load archive: " + error.message, true);
          console.error("Unable to load archived certificates.", error);
        }
      }

      async function showArchiveList() {
        if (currentMode === "draft" && !(await persistDraftNow())) return;
        setView("archive");
        archiveSearch.value = "";
        await refreshArchive();
      }

      async function returnToDraft() {
        try {
          const draft = await getDraftRecord();
          lastDraftSnapshot = draft || { id: draftKey, data: {}, photo: null };
          populateForm(lastDraftSnapshot.data || {}, lastDraftSnapshot.photo || null);
          status.textContent = draft ? "Working draft restored" : "Ready — working draft autosaves on this device";
        } catch (error) {
          status.textContent = "Could not restore working draft: " + error.message;
          console.error("Unable to restore the working draft.", error);
        }
      }

      async function openArchivedCertificate(id, printAfterOpen) {
        try {
          const record = await getArchiveRecord(id);
          if (!record) throw new Error("That archived certificate no longer exists.");
          activeArchiveRecord = record;
          populateForm(record.data, record.photo || null);
          setView("record");
          document.getElementById("archive-view-message").textContent =
            "Archived certificate " + record.id + " · Saved " + formatSavedDate(record.savedAt) + " · Read-only historical record.";
          status.textContent = "Viewing archived certificate (read-only)";
          if (printAfterOpen) window.setTimeout(() => window.print(), 150);
        } catch (error) {
          setArchiveStatus("Could not open certificate: " + error.message, true);
          console.error("Unable to open archived certificate.", error);
        }
      }

      function validateCertificateData(data) {
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          throw new Error("Certificate data must be an object.");
        }
        const result = {};
        Object.entries(data).forEach(([key, value]) => {
          if (key === "laboratoryTests" || key === "siteTests") {
            if (!Array.isArray(value)) throw new Error("Selected tests must be lists.");
            const available = key === "laboratoryTests" ? labTests : siteTests;
            const seen = new Set();
            result[key] = value.map((item) => {
              if (!item || typeof item.test !== "string" || typeof item.comment !== "string" ||
                  !available.includes(item.test) || seen.has(item.test)) {
                throw new Error("A selected test is invalid or duplicated.");
              }
              seen.add(item.test);
              return { test: item.test, comment: item.comment };
            });
          } else if (typeof value === "string" || typeof value === "boolean") {
            result[key] = value;
          } else {
            throw new Error("Certificate field data contains an unsupported value.");
          }
        });
        return result;
      }

      function validateArchivePhoto(photo) {
        if (photo === null || photo === undefined) return null;
        if (!photo || typeof photo.dataUrl !== "string" ||
            !/^data:image\/(?:jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(photo.dataUrl) ||
            (photo.name !== undefined && typeof photo.name !== "string")) {
          throw new Error("A certificate photo is invalid.");
        }
        return { dataUrl: photo.dataUrl, name: photo.name || "" };
      }

      function validateArchiveBackup(payload) {
        if (!payload || payload.format !== "sampling-certificate-archive" || payload.version !== 1 ||
            !Array.isArray(payload.certificates)) {
          throw new Error("This is not a supported sampling certificate archive backup.");
        }
        const seen = new Set();
        return payload.certificates.map((record) => {
          if (!record || typeof record.id !== "string" || !record.id.trim() || record.id.length > 200 ||
              typeof record.savedAt !== "string" || Number.isNaN(Date.parse(record.savedAt))) {
            throw new Error("A backup certificate is missing a valid ID or saved date.");
          }
          if (seen.has(record.id)) throw new Error("The backup contains duplicate certificate IDs.");
          seen.add(record.id);
          return {
            id: record.id,
            savedAt: new Date(record.savedAt).toISOString(),
            data: validateCertificateData(record.data),
            photo: validateArchivePhoto(record.photo)
          };
        });
      }

      async function addArchiveRecord(record) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await runTransaction("archives", "readwrite", (store) => store.add(record));
            return record;
          } catch (error) {
            if (error.name !== "ConstraintError" || attempt === 2) throw error;
            record.id = createArchiveId();
          }
        }
        throw new Error("Could not assign a unique certificate ID.");
      }

      async function saveToArchive() {
        if (currentMode !== "draft") return;
        const savedDraft = await persistDraftNow();
        if (!savedDraft) {
          status.textContent = "Archive save cancelled because the working draft could not be saved.";
          return;
        }
        const record = {
          id: createArchiveId(),
          savedAt: new Date().toISOString(),
          data: readForm(),
          photo: currentPhoto
        };
        try {
          await addArchiveRecord(record);
          status.textContent = "Certificate saved to archive · ID " + record.id;
        } catch (error) {
          status.textContent = "Archive save failed: " + error.message;
          console.error("Unable to save certificate to archive.", error);
        }
      }

      function importArchiveRecords(records) {
        return new Promise((resolve, reject) => {
          let transaction;
          try {
            transaction = database.transaction("archives", "readwrite");
          } catch (error) {
            reject(error);
            return;
          }
          let imported = 0;
          let transactionError = null;
          const store = transaction.objectStore("archives");
          const getAllRequest = store.getAll();
          getAllRequest.onerror = () => {
            transactionError = getAllRequest.error || new Error("Could not read existing archive.");
            transaction.abort();
          };
          getAllRequest.onsuccess = () => {
            const ids = new Set(getAllRequest.result.map((record) => record.id));
            records.forEach((record) => {
              const restored = { ...record };
              while (ids.has(restored.id)) restored.id = createArchiveId();
              ids.add(restored.id);
              store.add(restored);
              imported += 1;
            });
          };
          transaction.oncomplete = () => resolve(imported);
          transaction.onerror = () => { transactionError = transaction.error || new Error("Could not import archive backup."); };
          transaction.onabort = () => reject(transactionError || transaction.error || new Error("Archive import was aborted."));
        });
      }

      async function exportArchive() {
        try {
          const records = await getArchiveRecords();
          const backup = {
            format: "sampling-certificate-archive",
            version: 1,
            exportedAt: new Date().toISOString(),
            certificates: records
          };
          const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "sampling-certificate-archive-" + new Date().toISOString().slice(0, 10) + ".json";
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          setArchiveStatus(records.length + " certificate(s) exported.", false);
        } catch (error) {
          setArchiveStatus("Export failed: " + error.message, true);
          console.error("Unable to export archive backup.", error);
        }
      }

      async function importArchive(file) {
        if (!file) return;
        if (file.size > 100 * 1024 * 1024) {
          setArchiveStatus("Import failed: backup exceeds the 100 MB safety limit.", true);
          return;
        }
        try {
          const payload = JSON.parse(await file.text());
          const records = validateArchiveBackup(payload);
          const count = await importArchiveRecords(records);
          await refreshArchive();
          setArchiveStatus(count + " certificate(s) imported. Existing IDs were assigned new IDs where needed.", false);
        } catch (error) {
          setArchiveStatus("Import failed: " + error.message, true);
          console.error("Unable to import archive backup.", error);
        } finally {
          document.getElementById("import-archive-file").value = "";
        }
      }

      async function startDraftFromArchive(record) {
        if (!window.confirm("Start a new working draft using this archived certificate? This replaces the current working draft; the archived original will remain unchanged.")) return;
        populateForm(record.data, record.photo || null);
        const saved = await persistDraftNow();
        if (saved) {
          status.textContent = "New working draft started from archived certificate " + record.id;
        }
      }

      testingSections.forEach(initializeTestPicker);
      form.addEventListener("input", (event) => {
        if (!event.target.matches(".test-comment")) saveForm();
      });
      form.addEventListener("change", (event) => {
        if (!event.target.matches(".test-comment")) saveForm();
      });
      window.addEventListener("pagehide", () => {
        if (saveTimer !== null) void persistDraftNow();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && saveTimer !== null) void persistDraftNow();
      });
      photoInput.addEventListener("change", async () => {
        const file = photoInput.files[0];
        if (!file || currentMode !== "draft") return;
        try {
          const dataUrl = await preparePhoto(file);
          showPhoto({ dataUrl, name: file.name });
          saveForm();
        } catch (error) {
          status.textContent = "Could not load the selected photo: " + error.message;
          console.error("Unable to load the sampling certificate photo.", error);
        }
      });
      document.getElementById("remove-photo").addEventListener("click", () => {
        if (currentMode !== "draft") return;
        photoInput.value = "";
        showPhoto(null);
        saveForm();
      });
      document.getElementById("print-form").addEventListener("click", () => window.print());
      document.getElementById("open-archive").addEventListener("click", () => { void showArchiveList(); });
      document.getElementById("close-archive").addEventListener("click", () => { void returnToDraft(); });
      document.getElementById("return-to-archive").addEventListener("click", () => {
        activeArchiveRecord = null;
        setView("archive");
        void refreshArchive();
      });
      document.getElementById("save-to-archive").addEventListener("click", () => { void saveToArchive(); });
      document.getElementById("export-archive").addEventListener("click", () => { void exportArchive(); });
      document.getElementById("import-archive-button").addEventListener("click", () => {
        document.getElementById("import-archive-file").click();
      });
      document.getElementById("import-archive-file").addEventListener("change", (event) => {
        void importArchive(event.target.files[0]);
      });
      archiveSearch.addEventListener("input", renderArchiveCards);
      archiveList.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-archive-action]");
        if (!button) return;
        const record = archiveRecords.find((item) => item.id === button.dataset.archiveId);
        if (button.dataset.archiveAction === "delete") {
          if (!window.confirm("Permanently delete archived certificate " + button.dataset.archiveId + "? This cannot be undone. Export a backup first if you may need it.")) return;
          try {
            await deleteArchiveRecord(button.dataset.archiveId);
            setArchiveStatus("Archived certificate deleted.", false);
            await refreshArchive();
          } catch (error) {
            setArchiveStatus("Delete failed: " + error.message, true);
            console.error("Unable to delete archived certificate.", error);
          }
        } else if (record && button.dataset.archiveAction === "open") {
          await openArchivedCertificate(record.id, false);
        } else if (record && button.dataset.archiveAction === "print") {
          await openArchivedCertificate(record.id, true);
        } else if (record && button.dataset.archiveAction === "new-draft") {
          await startDraftFromArchive(record);
        }
      });
      document.getElementById("new-from-archive").addEventListener("click", () => {
        if (activeArchiveRecord) void startDraftFromArchive(activeArchiveRecord);
      });
      document.getElementById("clear-form").addEventListener("click", async () => {
        if (!window.confirm("Clear the working draft on this device? Archived certificates will not be deleted.")) return;
        if (saveTimer !== null) {
          window.clearTimeout(saveTimer);
          saveTimer = null;
        }
        form.reset();
        testingSections.forEach((section) => {
          section.selected = [];
          section.search.value = "";
          closeTestOptions(section);
          setTestValidation(section, "");
          renderSelectedTests(section);
        });
        photoInput.value = "";
        showPhoto(null);
        try {
          await deleteDraftRecord();
          lastDraftSnapshot = { id: draftKey, data: {}, photo: null };
          status.textContent = "Working draft cleared. Archived certificates are unchanged.";
        } catch (error) {
          status.textContent = "Draft cleared from the form, but device storage failed: " + error.message;
          console.error("Unable to clear the saved draft.", error);
        }
      });
      setView("draft");
      void initializeStorage();
    })();
  