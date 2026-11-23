
(function () {
    if (!window.AndroidMediaTransfer) return;

    const sender = document.getElementById("sender");
    if (!sender) return;

    const button = document.createElement("button");
    button.className = "gold";
    button.style.width = "100%";
    button.style.marginTop = "15px";
    button.textContent = "Tüm İzinleri Ver ve Aktar";

    const status = document.createElement("div");
    status.className = "status";
    status.textContent = "Aktarım için hazır.";

    const drop = sender.querySelector(".drop");
    sender.insertBefore(button, drop);
    sender.insertBefore(status, drop);

    let transfer = null;

    window.addEventListener("abdultransfer:joined", function (event) {
        transfer = event.detail;
        button.disabled = false;
    });

    button.addEventListener("click", function () {
        if (!transfer) {
            status.textContent = "Önce aktarım bağlantısına bağlanmalısın.";
            return;
        }

        button.disabled = true;
        status.textContent =
            "Android izin ekranı açılıyor. İzinleri onayla ve uygulamaya geri dön.";

        window.AndroidMediaTransfer.startTransfer(
            location.origin,
            transfer.code,
            transfer.token
        );
    });

    window.onNativeTransferProgress = function (data) {
        status.textContent = data.message;

        if (data.type === "progress") {
            status.textContent += " %" + data.percent;
        }

        if (data.type === "done" || data.type === "error") {
            button.disabled = false;
        }
    };
})();
