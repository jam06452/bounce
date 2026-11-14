const notes = document.querySelector("#notes");

function makenote() {
    const note = document.createElement("img");

    note.classList.add("note");

    note.src = [
        "assets/leaves/Screenshot_2026-11-14_153937-removebg-preview.png",
        "assets/leaves/Screenshot_2026-11-14_154013-removebg-preview.png",
        "assets/leaves/Screenshot_2026-11-14_154023-removebg-preview.png"
    ][Math.floor(Math.random() * 3)];

    note.style.left = Math.random() * 100 + "%";
    note.style.animationDuration = (8 + Math.random() * 8) + "s";
    note.style.setProperty("--rotation", (360 + Math.random() * 720) + "deg");
    note.style.width = (25 + Math.random() * 25) + "px";

    notes.appendChild(note);

    note.addEventListener("animationend", () => note.remove());
}

setInterval(makenote, 2000);