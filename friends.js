const setupPanel = document.querySelector("#friends-setup");
const authPanel = document.querySelector("#friends-auth");
const dashboard = document.querySelector("#friends-dashboard-content");
const authMessage = document.querySelector("#friend-auth-message");
const dashboardMessage = document.querySelector("#friends-message");
const authForm = document.querySelector("#friend-auth-form");
const addFriendForm = document.querySelector("#friend-add-form");
const scheduledLetterForm = document.querySelector("#scheduled-letter-form");
const recipientSelect = document.querySelector("#letter-recipient");
const unlockInput = document.querySelector("#scheduled-letter-date");

function showMessage(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle("friend-message-error", isError);
}

function formatFriendDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(value));
}

function appendEmptyMessage(target, message) {
  const empty = document.createElement("p");
  empty.className = "friend-empty";
  empty.textContent = message;
  target.append(empty);
}

function isValidSupabaseUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

const config = window.TMFS_SUPABASE_CONFIG;
if (!config?.url || !config?.anonKey) {
  setupPanel.hidden = false;
} else if (!isValidSupabaseUrl(config.url) || typeof config.anonKey !== "string") {
  setupPanel.hidden = false;
  setupPanel.querySelector("p").textContent = "The Supabase URL or public anon key in supabase-config.js is invalid. Check the project settings and reload the page.";
} else if (!window.supabase?.createClient) {
  setupPanel.hidden = false;
  setupPanel.querySelector("p").textContent = "The Supabase client could not load. Check your internet connection and reload the page.";
} else {
  setupPanel.hidden = true;
  authPanel.hidden = false;

  const client = window.supabase.createClient(config.url, config.anonKey);
  let currentUser = null;
  let friendships = [];
  let letters = [];
  let loadSequence = 0;
  let loadedUserId = null;

  function setAuthenticatedView() {
    const signedIn = Boolean(currentUser);
    authPanel.hidden = signedIn;
    dashboard.hidden = !signedIn;
    if (signedIn) {
      document.querySelector("#friend-account-email").textContent = currentUser.email || "";
      setUnlockMinimum();
    } else {
      document.querySelector("#friend-account-email").textContent = "";
      loadedUserId = null;
      friendships = [];
      letters = [];
      document.querySelector("#friend-requests").replaceChildren();
      document.querySelector("#friend-list").replaceChildren();
      document.querySelector("#received-letters").replaceChildren();
      document.querySelector("#sent-letters").replaceChildren();
      recipientSelect.replaceChildren(new Option("Sign in and add a friend first", ""));
    }
  }

  function setUnlockMinimum() {
    const localNow = new Date();
    localNow.setMinutes(localNow.getMinutes() - localNow.getTimezoneOffset());
    unlockInput.min = localNow.toISOString().slice(0, 16);
  }

  function makeFriendRow(email, detail, actionLabel, action) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = email;
    const description = document.createElement("span");
    description.textContent = detail;
    info.append(name, description);
    row.append(info);
    if (actionLabel) {
      const button = document.createElement("button");
      button.className = "button button-outline";
      button.type = "button";
      button.textContent = actionLabel;
      button.addEventListener("click", action);
      row.append(button);
    }
    return row;
  }

  function renderFriendships() {
    const requests = document.querySelector("#friend-requests");
    const friendList = document.querySelector("#friend-list");
    requests.replaceChildren();
    friendList.replaceChildren();

    const userEmail = (currentUser.email || "").toLowerCase();
    const incoming = friendships.filter((friendship) => (
      friendship.status === "pending"
      && friendship.recipient_email.toLowerCase() === userEmail
      && friendship.requester_id !== currentUser.id
    ));
    const outgoing = friendships.filter((friendship) => (
      friendship.status === "pending" && friendship.requester_id === currentUser.id
    ));
    const accepted = friendships.filter((friendship) => friendship.status === "accepted");

    if (incoming.length) {
      const heading = document.createElement("h3");
      heading.textContent = "Requests for you";
      requests.append(heading);
      incoming.forEach((friendship) => {
        requests.append(makeFriendRow(
          friendship.requester_email,
          "Wants to exchange future letters",
          "Accept",
          async () => {
            showMessage(dashboardMessage, "");
            try {
              const { error } = await client
                .from("friendships")
                .update({ status: "accepted", recipient_id: currentUser.id })
                .eq("id", friendship.id)
                .eq("status", "pending");
              if (error) {
                showMessage(dashboardMessage, `Could not accept request: ${error.message}`, true);
                return;
              }
              if (await loadDashboard()) showMessage(dashboardMessage, "Friend request accepted.");
            } catch (error) {
              showMessage(dashboardMessage, `Could not accept request: ${error.message}`, true);
            }
          },
        ));
      });
    }

    if (outgoing.length) {
      const heading = document.createElement("h3");
      heading.textContent = "Waiting for a reply";
      requests.append(heading);
      outgoing.forEach((friendship) => {
        requests.append(makeFriendRow(
          friendship.recipient_email,
          "Invite sent; waiting for them to accept",
          null,
        ));
      });
    }
    if (!incoming.length && !outgoing.length) {
      appendEmptyMessage(requests, "No friend requests yet.");
    }

    if (!accepted.length) {
      appendEmptyMessage(friendList, "Accepted friends will appear here.");
    } else {
      accepted.forEach((friendship) => {
        const friendEmail = friendship.requester_id === currentUser.id
          ? friendship.recipient_email
          : friendship.requester_email;
        friendList.append(makeFriendRow(friendEmail, "Ready to receive a future letter", null));
      });
    }

    recipientSelect.replaceChildren(new Option("Choose a friend...", ""));
    accepted.forEach((friendship) => {
      const friendEmail = friendship.requester_id === currentUser.id
        ? friendship.recipient_email
        : friendship.requester_email;
      recipientSelect.add(new Option(friendEmail, friendship.id));
    });
    document.querySelector("#scheduled-letter-form button[type='submit']").disabled = accepted.length === 0;
  }

  function makeLetterCard(letter, received) {
    const card = document.createElement("article");
    card.className = "friend-letter-card";
    const heading = document.createElement("h3");
    heading.textContent = letter.title;
    const meta = document.createElement("p");
    meta.className = "friend-letter-meta";
    if (received) {
      meta.textContent = `From ${letter.sender_email} · Ready ${formatFriendDate(letter.unlock_at)}`;
    } else {
      const status = new Date(letter.unlock_at) <= new Date() ? "Unlocked" : "Waiting";
      meta.textContent = `To ${letter.recipient_email} · ${status} ${formatFriendDate(letter.unlock_at)}`;
    }
    const body = document.createElement("p");
    body.className = "friend-letter-body";
    body.textContent = letter.body;
    card.append(heading, meta, body);
    return card;
  }

  function renderLetters() {
    const received = document.querySelector("#received-letters");
    const sent = document.querySelector("#sent-letters");
    received.replaceChildren();
    sent.replaceChildren();

    const incoming = letters.filter((letter) => letter.recipient_id === currentUser.id);
    const outgoing = letters.filter((letter) => letter.sender_id === currentUser.id);
    if (incoming.length) incoming.forEach((letter) => received.append(makeLetterCard(letter, true)));
    else appendEmptyMessage(received, "No letters have arrived yet. You’ll find them here on their delivery date.");
    if (outgoing.length) outgoing.forEach((letter) => sent.append(makeLetterCard(letter, false)));
    else appendEmptyMessage(sent, "Letters you schedule will appear here.");
  }

  async function loadDashboard() {
    if (!currentUser) return;
    const sequence = ++loadSequence;
    const userId = currentUser.id;
    showMessage(dashboardMessage, "");
    try {
      const [friendshipsResult, lettersResult] = await Promise.all([
        client.from("friendships")
          .select("id,requester_id,requester_email,recipient_email,recipient_id,status,created_at")
          .order("created_at", { ascending: false }),
        client.from("scheduled_letters")
          .select("id,friendship_id,sender_id,sender_email,recipient_id,title,body,unlock_at,created_at,recipient_email")
          .order("unlock_at", { ascending: true }),
      ]);
      if (friendshipsResult.error) throw friendshipsResult.error;
      if (lettersResult.error) throw lettersResult.error;
      if (sequence !== loadSequence || currentUser?.id !== userId) return;

      const nextFriendships = friendshipsResult.data || [];
      const nextLetters = lettersResult.data || [];
      const isRefresh = loadedUserId === userId;
      const previousFriendships = new Map(friendships.map((friendship) => [friendship.id, friendship]));
      const previousLetterIds = new Set(letters.map((letter) => letter.id));
      const newFriendships = isRefresh ? nextFriendships.filter((friendship) => {
        const previous = previousFriendships.get(friendship.id);
        return !previous || (previous.status !== "accepted" && friendship.status === "accepted");
      }).length : 0;
      const newLetters = isRefresh
        ? nextLetters.filter((letter) => !previousLetterIds.has(letter.id)).length
        : 0;
      friendships = nextFriendships;
      letters = nextLetters;
      renderFriendships();
      renderLetters();
      loadedUserId = userId;
      for (let index = 0; index < newFriendships + newLetters; index += 1) {
        window.triggerShootingStar?.();
      }
      return true;
    } catch (error) {
      if (sequence === loadSequence) {
        showMessage(dashboardMessage, `Could not load your friend letters: ${error.message}`, true);
      }
      return false;
    }
  }

  function signInRedirect() {
    const redirect = new URL(window.location.href);
    redirect.hash = "friends";
    return redirect.toString();
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(authMessage, "Sending your sign-in link...");
    const email = document.querySelector("#friend-auth-email").value.trim();
    try {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: signInRedirect() },
      });
      if (error) {
        showMessage(authMessage, `Could not send sign-in link: ${error.message}`, true);
        return;
      }
      showMessage(authMessage, `Check ${email} for your sign-in link.`);
    } catch (error) {
      showMessage(authMessage, `Could not send sign-in link: ${error.message}`, true);
    }
  });

  async function sendInvite(email) {
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: signInRedirect() },
    });
    if (error) throw error;
  }

  addFriendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(dashboardMessage, "Sending friend request...");
    const email = document.querySelector("#friend-email").value.trim().toLowerCase();
    if (!currentUser?.email || email === currentUser.email.toLowerCase()) {
      showMessage(dashboardMessage, "Enter a different email address to invite a friend.", true);
      return;
    }
    try {
      const { error } = await client.from("friendships").insert({
        requester_id: currentUser.id,
        requester_email: currentUser.email,
        recipient_email: email,
      });
      if (error) {
        showMessage(dashboardMessage, `Could not send friend request: ${error.message}`, true);
        return;
      }
    } catch (error) {
      showMessage(dashboardMessage, `Could not send friend request: ${error.message}`, true);
      return;
    }
    let inviteMessage;
    let inviteFailed = false;
    try {
      await sendInvite(email);
      inviteMessage = `Friend request sent. A sign-in link was emailed to ${email}.`;
    } catch (inviteError) {
      inviteMessage = `Friend request saved, but the sign-in link could not be sent: ${inviteError.message}`;
      inviteFailed = true;
    }
    addFriendForm.reset();
    await loadDashboard();
    showMessage(dashboardMessage, inviteMessage, inviteFailed);
  });

  scheduledLetterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage(dashboardMessage, "Sealing your letter...");
    const data = new FormData(scheduledLetterForm);
    const unlockAt = new Date(data.get("unlockAt"));
    if (!Number.isFinite(unlockAt.getTime()) || unlockAt.getTime() <= Date.now()) {
      showMessage(dashboardMessage, "Choose a future date and time for delivery.", true);
      return;
    }
    try {
      const { error } = await client.from("scheduled_letters").insert({
        friendship_id: data.get("friendshipId"),
        title: data.get("title").trim(),
        body: data.get("body").trim(),
        unlock_at: unlockAt.toISOString(),
      });
      if (error) {
        showMessage(dashboardMessage, `Could not schedule letter: ${error.message}`, true);
        return;
      }
      scheduledLetterForm.reset();
      setUnlockMinimum();
      if (await loadDashboard()) {
        showMessage(dashboardMessage, "Letter sealed. Your friend won’t see it before the delivery date.");
      }
    } catch (error) {
      showMessage(dashboardMessage, `Could not schedule letter: ${error.message}`, true);
    }
  });

  document.querySelector("#friend-refresh").addEventListener("click", loadDashboard);
  document.querySelector("#friend-signout").addEventListener("click", async () => {
    try {
      const { error } = await client.auth.signOut();
      if (error) showMessage(dashboardMessage, `Could not sign out: ${error.message}`, true);
    } catch (error) {
      showMessage(dashboardMessage, `Could not sign out: ${error.message}`, true);
    }
  });

  client.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    loadSequence += 1;
    setAuthenticatedView();
    if (currentUser) window.setTimeout(() => void loadDashboard(), 0);
  });

  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) {
        showMessage(authMessage, `Could not check your sign-in status: ${error.message}`, true);
        return;
      }
      currentUser = data.session?.user || null;
      setAuthenticatedView();
      if (currentUser) void loadDashboard();
    })
    .catch((error) => {
      showMessage(authMessage, `Could not check your sign-in status: ${error.message}`, true);
    });

  window.setInterval(() => {
    if (currentUser && location.hash === "#friends") void loadDashboard();
  }, 60_000);
}
