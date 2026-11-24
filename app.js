    (() => {
      const storageKey = "mae-sampling-certificate-v1";
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
      const photoStorageKey = storageKey + "-photo";
      const photoInput = document.getElementById("photo-upload");
      const photoPreview = document.getElementById("photo-preview");
      const photoPreviewImage = document.getElementById("photo-preview-image");
      const photoName = document.getElementById("photo-name");
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

      function saveForm() {
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(persistForm, 180);
      }

      function persistForm() {
        saveTimer = null;
        try {
          localStorage.setItem(storageKey, JSON.stringify(readForm()));
          status.textContent = "Saved in this browser";
        } catch (error) {
          status.textContent = "Could not save in this browser";
          console.error("Unable to save the sampling certificate.", error);
        }
      }

      function showPhoto(dataUrl, fileName) {
        photoPreviewImage.src = dataUrl;
        photoName.textContent = fileName || "Saved sample photograph";
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

      function restorePhoto() {
        try {
          const saved = localStorage.getItem(photoStorageKey);
          if (!saved) return;
          const photo = JSON.parse(saved);
          if (!photo || typeof photo.dataUrl !== "string" || !photo.dataUrl.startsWith("data:image/")) {
            throw new Error("Saved photo data has an invalid format.");
          }
          showPhoto(photo.dataUrl, typeof photo.name === "string" ? photo.name : "");
        } catch (error) {
          status.textContent = "Could not restore saved photo";
          console.error("Unable to restore the sampling certificate photo.", error);
        }
      }

      function restoreForm() {
        try {
          const saved = localStorage.getItem(storageKey);
          if (!saved) return;
          const data = JSON.parse(saved);
          if (data === null || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Saved certificate data has an invalid format.");
          }
          Array.from(form.elements).forEach((element) => {
            if (!element.name || !Object.prototype.hasOwnProperty.call(data, element.name)) return;
            if (element.type === "checkbox") element.checked = data[element.name] === true;
            else if (typeof data[element.name] === "string") element.value = data[element.name];
          });
          testingSections.forEach((section) => restoreSelectedTests(section, data));
          status.textContent = "Restored saved certificate";
        } catch (error) {
          status.textContent = "Could not restore saved certificate";
          console.error("Unable to restore the sampling certificate.", error);
        }
      }

      testingSections.forEach(initializeTestPicker);
      restoreForm();
      restorePhoto();
      form.addEventListener("input", (event) => {
        if (!event.target.matches(".test-comment")) saveForm();
      });
      form.addEventListener("change", (event) => {
        if (!event.target.matches(".test-comment")) saveForm();
      });
      window.addEventListener("pagehide", () => {
        if (saveTimer !== null) {
          window.clearTimeout(saveTimer);
          saveTimer = null;
          persistForm();
        }
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && saveTimer !== null) {
          window.clearTimeout(saveTimer);
          saveTimer = null;
          persistForm();
        }
      });
      photoInput.addEventListener("change", async () => {
        const file = photoInput.files[0];
        if (!file) return;
        try {
          const dataUrl = await preparePhoto(file);
          showPhoto(dataUrl, file.name);
          try {
            localStorage.setItem(photoStorageKey, JSON.stringify({ dataUrl, name: file.name }));
            status.textContent = "Photo saved in this browser";
          } catch (error) {
            status.textContent = "Photo loaded but could not be saved in this browser";
            console.error("Unable to save the sampling certificate photo.", error);
          }
        } catch (error) {
          status.textContent = "Could not load the selected photo";
          console.error("Unable to load the sampling certificate photo.", error);
        }
      });
      document.getElementById("remove-photo").addEventListener("click", () => {
        photoInput.value = "";
        photoPreviewImage.removeAttribute("src");
        photoPreview.hidden = true;
        try {
          localStorage.removeItem(photoStorageKey);
          status.textContent = "Photo removed";
        } catch (error) {
          status.textContent = "Could not remove saved photo";
          console.error("Unable to remove the saved sampling certificate photo.", error);
        }
      });
      document.getElementById("print-form").addEventListener("click", () => window.print());
      document.getElementById("clear-form").addEventListener("click", () => {
        if (!window.confirm("Clear all certificate entries saved in this browser?")) return;
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
        try {
          localStorage.removeItem(storageKey);
          localStorage.removeItem(photoStorageKey);
          photoInput.value = "";
          photoPreviewImage.removeAttribute("src");
          photoPreview.hidden = true;
          status.textContent = "Form cleared";
        } catch (error) {
          status.textContent = "Could not clear saved certificate";
          console.error("Unable to clear the saved sampling certificate.", error);
        }
      });
    })();
  