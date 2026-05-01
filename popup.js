const toggle=document.getElementById("toggle");
const status=document.getElementById("status");

// load current state
chrome.storage.local.get("enabled", (data) => {
    const on = data.enabled ?? false;
    toggle.checked = on;
    updateStatus(on);
});

toggle.addEventListener("change", () => {
    const on = toggle.checked;
    chrome.storage.local.set({ enabled: on });
    updateStatus(on);
});

function updateStatus(on) {
    console.log(on ? "Chat blocker enabled." : "Chat blocker disabled.");
    status.textContent = on ? "Blocking new chats..." : "Inactive";
}