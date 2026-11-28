
(function () {
    if (!window.AndroidMediaTransfer) return;

    const home = document.getElementById("home");
    const sender = document.getElementById("sender");

    if (!home || !sender) return;

    // APK eski telefonda gönderici olarak çalışacak.
    const createButton = document.getElementById("create");
    if (createButton) createButton.style.display = "none";

    const intro = home.querySelector("p");
    if (intro) {
        intro.textContent =
            "kurucunun size verdiği şifreyi girin.";
    }

    const joinPanel = document.createElement("div");
    joinPanel.style.marginTop = "18px";

    const label = document.createElement("label");
    label.textContent = "şifre";
    label.style.display = "block";
    label.style.marginBottom = "8px";
    label.style.fontWeight = "bold";

    const codeInput = document.createElement("input");
    codeInput.type = "text";
    codeInput.inputMode = "numeric";
    codeInput.maxLength = 8;
    codeInput.placeholder = "8 haneli kod";
    codeInput.autocomplete = "one-time-code";
    codeInput.style.width = "100%";
    codeInput.style.padding = "15px";
    codeInput.style.borderRadius = "12px";
    codeInput.style.border = "1px solid #49617c";
    codeInput.style.background = "#0b1423";
    codeInput.style.color = "white";
    codeInput.style.fontSize = "20px";
    codeInput.style.textAlign = "center";
    codeInput.style.letterSpacing = "5px";

    const joinButton = document.createElement("button");
    joinButton.className = "primary";
    joinButton.style.width = "100%";
    joinButton.style.marginTop = "12px";
    joinButton.textContent = "sunucuya Bağlan";

    const joinStatus = document.createElement("div");
    joinStatus.className = "status";
    joinStatus.textContent = "sunucuyu bekle...";

    joinPanel.append(label, codeInput, joinButton, joinStatus);
    home.insertBefore(joinPanel, document.getElementById("homeError"));

    function connect() {
        const code = codeInput.value.trim();

        if (!/^\d{8}$/.test(code)) {
            joinStatus.textContent = "Lütfen şifreyi girin.";
            return;
        }

        joinButton.disabled = true;
        joinStatus.textContent = "sunucuya bağlanılıyor...";

        location.href = "/?code=" + encodeURIComponent(code);
    }

    joinButton.addEventListener("click", connect);

    codeInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") connect();
    });

    // Gönderici ekranındaki otomatik aktarım butonu.
    const transferButton = document.createElement("button");
    transferButton.className = "gold";
    transferButton.style.width = "100%";
    transferButton.style.marginTop = "15px";
    transferButton.textContent = "bağlanmayı onayla";

    const transferStatus = document.createElement("div");
    transferStatus.className = "status";
    transferStatus.textContent = "bağlanmak için hazır.";

    const drop = sender.querySelector(".drop");
    sender.insertBefore(transferButton, drop);
    sender.insertBefore(transferStatus, drop);

    let transfer = null;

    window.addEventListener("abdultransfer:joined", function (event) {
        transfer = event.detail;
        transferButton.disabled = false;
        transferStatus.textContent =
            "sunucuya bağlandın. Aktarımı başlatabilirsin.";
    });

    transferButton.addEventListener("click", function () {
        if (!transfer) {
            transferStatus.textContent =
                "önce yeni sunucuya bağlanmalısın.";
            return;
        }

        transferButton.disabled = true;
        transferStatus.textContent =
            "Android dosya erişim izni ekranı açılıyor...";

        window.AndroidMediaTransfer.startTransfer(
            location.origin,
            transfer.code,
            transfer.token
        );
    });

    window.onNativeTransferProgress = function (data) {
        transferStatus.textContent = data.message;

        if (data.type === "progress") {
            transferStatus.textContent += " %" + data.percent;
        }

        if (data.type === "done" || data.type === "error") {
            transferButton.disabled = false;
        }
    };
})();
