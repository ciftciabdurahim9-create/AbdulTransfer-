
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
            "Yeni telefonda Chrome üzerinden oluşturduğun 8 haneli aktarım kodunu gir.";
    }

    const joinPanel = document.createElement("div");
    joinPanel.style.marginTop = "18px";

    const label = document.createElement("label");
    label.textContent = "Yeni telefonun aktarım kodu";
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
    joinButton.textContent = "Yeni Telefona Bağlan";

    const joinStatus = document.createElement("div");
    joinStatus.className = "status";
    joinStatus.textContent = "Yeni telefonda oda oluştur.";

    joinPanel.append(label, codeInput, joinButton, joinStatus);
    home.insertBefore(joinPanel, document.getElementById("homeError"));

    function connect() {
        const code = codeInput.value.trim();

        if (!/^\d{8}$/.test(code)) {
            joinStatus.textContent = "Lütfen 8 haneli kodu gir.";
            return;
        }

        joinButton.disabled = true;
        joinStatus.textContent = "Yeni telefona bağlanılıyor...";

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
    transferButton.textContent = "Tüm İzinleri Ver ve Aktar";

    const transferStatus = document.createElement("div");
    transferStatus.className = "status";
    transferStatus.textContent = "Aktarım için hazır.";

    const drop = sender.querySelector(".drop");
    sender.insertBefore(transferButton, drop);
    sender.insertBefore(transferStatus, drop);

    let transfer = null;

    window.addEventListener("abdultransfer:joined", function (event) {
        transfer = event.detail;
        transferButton.disabled = false;
        transferStatus.textContent =
            "Yeni telefona bağlandın. Aktarımı başlatabilirsin.";
    });

    transferButton.addEventListener("click", function () {
        if (!transfer) {
            transferStatus.textContent =
                "Önce yeni telefona bağlanmalısın.";
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
