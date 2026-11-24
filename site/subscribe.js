// Signup form for defi360.news.
// Without this script the form still works: the browser posts it and the
// Worker answers with a page. With it, the result appears under the form.

(function () {
  var form = document.querySelector("form.signup");
  var status = document.querySelector(".signup-status");
  if (!form || !status || !window.fetch) return;

  var button = form.querySelector("button[type=submit]");

  function show(message, state) {
    status.textContent = message;
    status.setAttribute("data-state", state);
    status.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    button.disabled = true;

    fetch(form.action, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: form.email.value, company: form.company.value }),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok && body.ok, message: body.message };
        });
      })
      .then(function (result) {
        if (result.ok) {
          show(result.message, "ok");
          form.reset();
        } else {
          show(result.message || "Something went wrong. Please try again.", "error");
        }
      })
      .catch(function () {
        show("We could not reach the server. Check your connection and try again.", "error");
      })
      .then(function () {
        button.disabled = false;
      });
  });
})();
