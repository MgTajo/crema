"use strict";
/* ============================================================
   i18n.de — Crema auf Deutsch.

   Keys are the English source strings (see src/i18n.js for why).
   Anything missing here falls back to English, so a half-finished
   translation degrades to a readable app rather than to a broken one.

   Register: duzen, short sentences, the same dry voice the English has.
   Crema is a hobby app for people who care about one cup a day, not a
   Kundenportal, so "Melde dich an" beats "Bitte authentifizieren Sie
   sich".

   Catalogue VALUES — drink names, milk names, tasting notes, origin
   lines, the level titles — are translated too, but for the eye only.
   The English string is what is stored and matched against: a <select>
   carries it in `value` and shows the German label (selectOptions() in
   ui/components.js), and a stored "Oat" is read back through t()
   wherever it is shown. Translating the LABEL cannot split anyone's
   stats; translating the value would, which is why this rule matters
   more than the words do. See the catalogue section further down.

   Still NOT translated, because they are proper nouns: machine brands
   and models, roasters, and the names of individual coffees.

   Terms kept as the coffee scene actually uses them in German:
   "Streak", "Latte Art", "Rosetta", "posten", "liken", "Follower".
   ============================================================ */
export const DE = {

  /* ---------- gate, onboarding, account ---------- */
  'Welcome back':'Willkommen zurück',
  'Create your account':'Konto erstellen',
  'Reset your password':'Passwort zurücksetzen',
  'We will send you a link by email. Open it on this device and you can pick a new password.':
    'Wir schicken dir einen Link per E-Mail. Öffne ihn auf diesem Gerät, dann kannst du ein neues Passwort wählen.',
  'Log the coffee you make and watch the habit build. The people here care about the same 30 seconds of the morning that you do.':
    'Trag den Kaffee ein, den du machst, und sieh der Gewohnheit beim Wachsen zu. Die Leute hier hängen an denselben 30 Sekunden am Morgen wie du.',
  'Sign in to pick up where you left off.':'Melde dich an und mach da weiter, wo du aufgehört hast.',
  'Email':'E-Mail',
  'Password':'Passwort',
  'Your password':'Dein Passwort',
  'At least 8 characters':'Mindestens 8 Zeichen',
  'Show password':'Passwort anzeigen',
  'Hide password':'Passwort verbergen',
  'or':'oder',
  'Continue with Google':'Weiter mit Google',
  'Sending…':'Wird gesendet…',
  'Email me a reset link':'Schick mir einen Link',
  'Back to sign in':'Zurück zur Anmeldung',
  'Just a moment…':'Einen Moment…',
  'Create account':'Konto erstellen',
  'Sign in':'Anmelden',
  'Forgot your password?':'Passwort vergessen?',
  'Already have an account?':'Du hast schon ein Konto?',
  'New to Crema?':'Neu bei Crema?',
  'Create one':'Konto erstellen',
  'Your coffee log is stored in the EU and belongs to you.':'Dein Kaffee-Logbuch liegt in der EU und gehört dir.',
  'Crema never posts anything without you.':'Crema postet nie etwas ohne dich.',
  'Keep reading today\'s pours':'Weiter zu den Kaffees von heute',
  'Back to today\'s pours':'Zurück zu den Kaffees von heute',
  'Welcome':'Willkommen',
  'Welcome to Crema':'Willkommen bei Crema',
  'Welcome to Crema ☕':'Willkommen bei Crema ☕',
  'Your name':'Dein Name',
  'e.g. Alex Rivera':'z. B. Alex Rivera',
  'Username':'Benutzername',
  'yourname':'deinname',
  'City':'Stadt',
  'Your city':'Deine Stadt',
  'Continue':'Weiter',
  'Your setup':'Dein Setup',
  'New posts start with this filled in. You can change it any time in Settings.':
    'Neue Beiträge starten damit ausgefüllt. Ändern kannst du das jederzeit in den Einstellungen.',
  'Go-to drink':'Lieblingsgetränk',
  'Go-to milk':'Lieblingsmilch',
  'Back':'Zurück',
  'Start brewing':'Los geht’s',
  'Tell us your name first.':'Sag uns zuerst deinen Namen.',
  'That username is taken. Try another.':'Der Benutzername ist vergeben. Nimm einen anderen.',
  'Enter your email address.':'Gib deine E-Mail-Adresse ein.',
  'Enter your password.':'Gib dein Passwort ein.',
  'Pick a password of at least 8 characters.':'Wähl ein Passwort mit mindestens 8 Zeichen.',
  'Pick a longer password, at least 8 characters.':'Wähl ein längeres Passwort, mindestens 8 Zeichen.',
  'Account created. Confirm your email address, then sign in.':
    'Konto erstellt. Bestätige deine E-Mail-Adresse und melde dich dann an.',
  'Account created. Confirm your email address, then sign in — your setup is waiting.':
    'Konto erstellt. Bestätige deine E-Mail-Adresse und melde dich dann an — dein Setup wartet.',
  'Last step. The account is what keeps your setup, your streak and your pours.':
    'Letzter Schritt. Das Konto hält dein Setup, deine Serie und deine Tassen fest.',
  'Back to your setup':'Zurück zum Setup',
  'Reset link sent. Open it on this device and you can set a new password.':
    'Link ist unterwegs. Öffne ihn auf diesem Gerät, dann kannst du ein neues Passwort setzen.',
  'That email and password do not match.':'E-Mail und Passwort passen nicht zusammen.',
  'That email already has an account. Sign in instead.':'Zu dieser E-Mail gibt es schon ein Konto. Melde dich damit an.',
  'Confirm your email address first. Check your inbox.':'Bestätige zuerst deine E-Mail-Adresse. Schau in dein Postfach.',
  'Too many attempts just now. Wait a minute and try again.':'Gerade zu viele Versuche. Warte eine Minute und probier es nochmal.',
  'Crema is out of reach. Check your connection and try again.':'Crema ist nicht erreichbar. Prüf deine Verbindung und probier es nochmal.',
  'Something went wrong. Try again.':'Da ist etwas schiefgegangen. Probier es nochmal.',
  'Signed in ☕':'Angemeldet ☕',
  'Signed out. You can still look around.':'Abgemeldet. Umsehen kannst du dich trotzdem.',
  'Sign out':'Abmelden',
  'Sign out of Crema on this device?':'Auf diesem Gerät von Crema abmelden?',
  'Signed in':'Angemeldet',
  'Signed in · your pours live in your account':'Angemeldet · deine Kaffees liegen in deinem Konto',
  'Change password':'Passwort ändern',
  'New password':'Neues Passwort',
  'Repeat it':'Wiederholen',
  'Once more':'Noch einmal',
  'Saving…':'Wird gespeichert…',
  'Save password':'Passwort speichern',
  'At least 8 characters, please.':'Bitte mindestens 8 Zeichen.',
  'Those two do not match.':'Die beiden stimmen nicht überein.',
  'Password changed 🔑':'Passwort geändert 🔑',
  'Sign in first':'Melde dich zuerst an',

  /* ---------- the guest wall ---------- */
  'Sign in to like this':'Melde dich an, um zu liken',
  'A heart is the smallest way to say you saw it.':'Ein Herz ist die kleinste Art zu sagen: gesehen.',
  'Sign in to react':'Melde dich an, um zu reagieren',
  'Say which part you loved: the art, the spot or the coffee.':'Sag, was dir gefallen hat: die Art, der Ort oder der Kaffee.',
  'Sign in to join in':'Melde dich an und misch dich ein',
  'Comments are people talking about coffee. Bring yours.':'In den Kommentaren reden Leute über Kaffee. Bring deinen mit.',
  'Sign in to keep this':'Melde dich an, um das zu behalten',
  'Save a pour and its recipe is one tap away tomorrow morning.':'Merk dir einen Kaffee, dann ist sein Rezept morgen früh einen Tipp entfernt.',
  'Sign in to follow':'Melde dich an, um zu folgen',
  'Follow someone and their mornings show up in your feed.':'Folge jemandem, dann landen dessen Morgen in deinem Feed.',
  'Sign in to log your coffee':'Melde dich an und trag deinen Kaffee ein',
  'A photo and the drink is all it takes. That is day one of the streak.':'Ein Foto und das Getränk, mehr braucht es nicht. Das ist Tag eins deiner Streak.',
  'Sign in for your own feed':'Melde dich an für deinen eigenen Feed',
  'Following is the coffee of the people you picked.':'„Folge ich“ ist der Kaffee der Leute, die du ausgesucht hast.',
  'Sign in for your profile':'Melde dich an für dein Profil',
  'Your pours, your streak, your beans and your level.':'Deine Kaffees, deine Streak, deine Bohnen und dein Level.',
  'Sign in to see people':'Melde dich an, um Leute zu sehen',
  'Profiles, followers, and who poured what.':'Profile, Follower und wer was gemacht hat.',
  'Sign in to explore':'Melde dich an zum Entdecken',
  'Today\'s podium, this week\'s challenges and people to follow.':'Das Podium von heute, die Challenges der Woche und Leute zum Folgen.',
  'Sign in for cafés':'Melde dich an für Cafés',
  'Follow the places you drink at and see what gets poured there.':'Folge den Läden, in denen du trinkst, und sieh, was dort gemacht wird.',
  'Sign in for your inbox':'Melde dich an für dein Postfach',
  'Likes, comments and follows land here.':'Likes, Kommentare und neue Follower landen hier.',
  'Create your Crema account':'Erstell dein Crema-Konto',
  'It is free and takes about a minute. Then everything here is yours too.':'Kostenlos, dauert etwa eine Minute. Danach gehört dir das hier auch.',
  'I already have one':'Ich habe schon eins',
  'Keep looking around':'Weiter umsehen',
  'Sign in to join the conversation':'Melde dich an, um mitzureden',
  'Sign in to add a photo':'Melde dich an, um ein Foto hinzuzufügen',
  'Sign in to block someone':'Melde dich an, um jemanden zu blockieren',
  'Sign in to report a pour':'Melde dich an, um einen Kaffee zu melden',

  /* ---------- navigation & app bar ---------- */
  'Home':'Start',
  'Explore':'Entdecken',
  'Cafés':'Cafés',
  'You':'Du',
  'Profile':'Profil',
  'Settings':'Einstellungen',
  'Notifications':'Mitteilungen',
  'New coffee':'Neuer Kaffee',
  'Reload Crema':'Crema neu laden',
  'Day streak':'Tage-Streak',
  'Not poured today':'Heute noch nichts gemacht',
  'Search':'Suchen',
  'Close':'Schließen',
  'Cancel':'Abbrechen',
  'Language':'Sprache',

  /* ---------- feed ---------- */
  'Today':'Heute',
  'Following':'Folge ich',
  'Loading your feed…':'Dein Feed wird geladen…',
  'Loading today\'s pours…':'Die Kaffees von heute werden geladen…',
  'Nobody you follow has poured yet.':'Von den Leuten, denen du folgst, kam heute noch nichts.',
  'Find baristas on Explore.':'Finde Baristas unter Entdecken.',
  'Nobody has poured today yet.':'Heute hat noch niemand etwas gemacht.',
  'Tap ＋ and be the first.':'Tipp auf ＋ und sei die erste Person.',
  'Come back in the morning.':'Komm morgen früh wieder.',
  'Every cup, kept.':'Jede Tasse, festgehalten.',
  'Your streak and your beans, plus the people who care about the same 30 seconds of the morning that you do.':
    'Deine Streak und deine Bohnen, dazu die Leute, die an denselben 30 Sekunden am Morgen hängen wie du.',
  'Already have one?':'Schon ein Konto?',
  '{n} follow request':'{n} Follower-Anfrage',
  '{n} follow requests':'{n} Follower-Anfragen',
  /* The pill above the feed. "Kaffee" is what a pour is called
     everywhere else in this file, so it is what it is called here. */
  '{n} new pour':'{n} neuer Kaffee',
  '{n} new pours':'{n} neue Kaffees',
  '{n} friend has already brewed today ☕':'{n} Freund:in hat heute schon Kaffee gemacht ☕',
  '{n} friends have already brewed today ☕':'{n} Freund:innen haben heute schon Kaffee gemacht ☕',
  'Accept':'Annehmen',
  'Decline':'Ablehnen',

  /* ---------- streak ---------- */
  'No pour yet today':'Heute noch kein Kaffee',
  'A rest day would cover you, once.':'Ein Ruhetag würde dich retten, einmal.',
  'Rest day already used.':'Ruhetag ist schon aufgebraucht.',
  '{n} day on the line.':'{n} Tag steht auf dem Spiel.',
  '{n} days on the line.':'{n} Tage stehen auf dem Spiel.',
  'Log one':'Eintragen',
  'Your best yet.':'Dein bisher bester Lauf.',
  'Best: {n} days.':'Bester Lauf: {n} Tage.',
  '{n} days in a row':'{n} Tage am Stück',
  'Start a new streak':'Starte eine neue Streak',
  'Your best was {n} days.':'Dein bester Lauf waren {n} Tage.',
  'Log a pour':'Kaffee eintragen',
  'Streak':'Streak',
  'Your streak':'Deine Streak',
  'day in a row':'Tag am Stück',
  'days in a row':'Tage am Stück',
  'nothing logged today yet':'heute noch nichts eingetragen',
  'Last four weeks':'Die letzten vier Wochen',
  'Rest days':'Ruhetage',
  'Once a streak reaches {n} days, missing a single day will not end it. One rest day is forgiven, once. Two days in a row still starts you over.':
    'Ab {n} Tagen Streak beendet ein einzelner ausgelassener Tag sie nicht. Ein Ruhetag wird dir verziehen, einmal. Zwei Tage hintereinander setzen dich wieder auf null.',
  'Your rest day is currently in use.':'Dein Ruhetag ist gerade im Einsatz.',
  'Your rest day is available.':'Dein Ruhetag ist verfügbar.',
  'Yesterday':'Gestern',
  '{n} days ago':'vor {n} Tagen',

  /* ---------- explore, podium, challenges ---------- */
  'People to follow':'Leute zum Folgen',
  'This week\'s challenges':'Die Challenges dieser Woche',
  'All three':'Alle drei',
  'Today\'s podium':'Das Podium von heute',
  'Nothing on today\'s podium yet.':'Auf dem Podium von heute steht noch nichts.',
  'Post a pour. The day\'s three most-loved coffees land here.':'Poste einen Kaffee. Die drei beliebtesten des Tages landen hier.',
  'Nobody else to follow yet. You are early.':'Noch niemand zum Folgen da. Du bist früh dran.',
  'Search people, beans, cafés, pours…':'Leute, Bohnen, Cafés, Kaffees suchen…',
  'The three most-loved pours of the day, counting likes and comments alike. The board clears at midnight, so everyone starts level tomorrow.':
    'Die drei beliebtesten Kaffees des Tages, Likes und Kommentare zählen gleich viel. Um Mitternacht wird das Podium geleert, morgen fangen alle gleich an.',
  'Trending patterns':'Beliebte Muster',
  'No challenges are running right now.':'Gerade läuft keine Challenge.',
  'Three new ones land every Monday.':'Jeden Montag kommen drei neue.',
  'Loading this week’s challenges…':'Die Challenges der Woche werden geladen…',
  'Loading challenges…':'Challenges werden geladen…',
  'Challenges':'Challenges',
  'This week':'Diese Woche',
  'Three challenges a week, one of each kind. They start every Monday and score themselves from the coffee you log.':
    'Drei Challenges pro Woche, von jeder Sorte eine. Sie starten montags und werten sich selbst aus dem Kaffee aus, den du einträgst.',
  'Habit':'Gewohnheit',
  'Craft':'Handwerk',
  'Discovery':'Entdeckung',
  'Done':'Geschafft',
  'Complete':'Abgeschlossen',
  'Earned':'Verdient',
  'Earned this week':'Diese Woche verdient',
  '{time} left':'noch {time}',
  'ending':'endet',
  'under an hour':'unter einer Stunde',
  '{n} day':'{n} Tag',
  '{n} days':'{n} Tage',
  '+{n} points':'+{n} Punkte',
  'What counts':'Was zählt',
  'Finished. The {n} points are already on your score.':'Fertig. Die {n} Punkte stehen schon auf deinem Konto.',
  'You got to {n}.':'Du bist auf {n} gekommen.',
  '{n} to go. There is nothing to enter, because your pours count on their own.':
    'Noch {n}. Anmelden musst du dich nirgends, deine Kaffees zählen von allein.',
  'Log a coffee':'Kaffee eintragen',
  'Keep pouring.':'Brüh weiter.',
  'Log a coffee on {n} different days.':'Trag an {n} verschiedenen Tagen einen Kaffee ein.',
  'Log {n} coffees in total.':'Trag insgesamt {n} Kaffees ein.',
  'Log a coffee before {h}:00 your time, on {n} different days. Anything before 4am counts as the night before.':
    'Trag an {n} verschiedenen Tagen vor {h}:00 Uhr deiner Zeit einen Kaffee ein. Alles vor 4 Uhr zählt zur Nacht davor.',
  'Log a coffee after {h}:00 your time, on {n} different days.':'Trag an {n} verschiedenen Tagen nach {h}:00 Uhr deiner Zeit einen Kaffee ein.',
  'Log a coffee on Saturday and again on Sunday.':'Trag am Samstag einen Kaffee ein und am Sonntag noch einen.',
  'Post {n} latte-art pours with a {pattern}.':'Poste {n} Latte-Art-Kaffees mit einem {pattern}.',
  'Post {n} pours with latte art, any pattern.':'Poste {n} Kaffees mit Latte Art, Muster egal.',
  'Post {n} pours with dose, yield and time all filled in.':'Poste {n} Kaffees mit Einwaage, Auswaage und Zeit.',
  'Post {n} pours with a note of at least 20 characters.':'Poste {n} Kaffees mit einer Notiz von mindestens 20 Zeichen.',
  'Log {n} different drinks.':'Trag {n} verschiedene Getränke ein.',
  'Brew {n} different coffees.':'Brüh {n} verschiedene Kaffees.',
  'Use {n} different milks.':'Nimm {n} verschiedene Milchsorten.',
  'Log a coffee at {n} different cafés.':'Trag in {n} verschiedenen Cafés einen Kaffee ein.',
  'Brew beans grown in {n} different countries. Coffees whose origin the catalogue does not know cannot count.':
    'Brüh Bohnen aus {n} verschiedenen Ländern. Kaffees, deren Herkunft der Katalog nicht kennt, zählen nicht mit.',
  'Brew coffee from {n} different roasters.':'Brüh Kaffee von {n} verschiedenen Röstereien.',
  'Log {n} coffee you have never logged before.':'Trag {n} Kaffee ein, den du noch nie eingetragen hast.',
  'Leave {n} comments on other people\'s coffee. Your own do not count.':'Schreib {n} Kommentare unter den Kaffee anderer Leute. Deine eigenen zählen nicht.',
  'this week\'s challenge':'Challenge dieser Woche',
  '{n} pour':'{n} Kaffee',
  '{n} pours':'{n} Kaffees',
  'pour':'Kaffee',
  'pours':'Kaffees',
  'No {pattern} pours yet. Be the first.':'Noch keine {pattern}-Kaffees. Mach den Anfang.',
  'Post a pour':'Kaffee posten',

  /* ---------- post, comments, reactions ---------- */
  'Post':'Beitrag',
  'Post it':'Posten',
  'Share':'Teilen',
  'Like':'Liken',
  'Like comment':'Kommentar liken',
  'Comments':'Kommentare',
  'comments':'Kommentare',
  'Save':'Merken',
  'More options':'Mehr Optionen',
  'Post options':'Beitrag-Optionen',
  'at':'bei',
  'Coffee':'Kaffee',
  'coffee':'Kaffee',
  'Brew this recipe':'Rezept nachbrühen',
  'Loading comments…':'Kommentare werden geladen…',
  'Be the first to comment.':'Schreib den ersten Kommentar.',
  'No comments yet.':'Noch keine Kommentare.',
  'Add a comment':'Kommentar schreiben',
  'Add a comment… use @ to name someone':'Kommentar schreiben… mit @ jemanden nennen',
  'Send':'Senden',
  'Reply':'Antworten',
  'now':'gerade eben',
  'View all {n} comments':'Alle {n} Kommentare ansehen',
  'edited':'bearbeitet',
  'followers':'Follower',
  'Only people who follow you can see this':'Das sehen nur Leute, die dir folgen',
  /* Moderation, as the author of a hidden pour sees it. The admin screen
     itself stays English — one person reads it. */
  'hidden':'ausgeblendet',
  'Hidden after a report. Check your notifications.':'Nach einer Meldung ausgeblendet. Schau in deine Benachrichtigungen.',
  'Your own pour':'Dein eigener Kaffee',
  '(you)':'(du)',
  'Recipe':'Rezept',
  'Recipe · {a} in → {b} out':'Rezept · {a} rein → {b} raus',
  '+ Add recipe (bean, machine, dose…)':'+ Rezept hinzufügen (Bohne, Maschine, Einwaage…)',
  'Remove recipe':'Rezept entfernen',
  'Copy link':'Link kopieren',
  'Remove from saved':'Aus Gemerkt entfernen',
  'Save to collection':'In die Sammlung',
  'Edit this pour':'Diesen Kaffee bearbeiten',
  'Delete this pour':'Diesen Kaffee löschen',
  'Report':'Melden',
  'Block {name}':'{name} blockieren',
  'this person':'diese Person',
  'Comment added 💬':'Kommentar hinzugefügt 💬',
  'That comment did not post':'Der Kommentar ging nicht raus',
  'Slow down a moment. That is too many comments at once.':'Mach mal langsam. Das sind zu viele Kommentare auf einmal.',
  'You cannot like your own pour':'Deinen eigenen Kaffee kannst du nicht liken',
  'That like did not save':'Das Like wurde nicht gespeichert',
  'Reactions are for other people\'s coffee':'Reaktionen sind für den Kaffee anderer Leute',
  'That reaction did not save':'Die Reaktion wurde nicht gespeichert',
  'Saved to your collection 🔖':'In deine Sammlung gemerkt 🔖',
  'Removed from saved':'Aus Gemerkt entfernt',
  'Your collection did not update':'Deine Sammlung wurde nicht aktualisiert',
  'Link copied 🔗':'Link kopiert 🔗',
  'Maps link copied 🔗':'Karten-Link kopiert 🔗',
  'Copied ✓':'Kopiert ✓',
  'Copying is not available here. Long-press the post instead.':'Kopieren geht hier nicht. Halt den Beitrag stattdessen lang gedrückt.',
  'Coffee, brewed social. Log what you pour.':'Kaffee, sozial gebrüht. Trag ein, was du machst.',
  'Recipe loaded. Brew it again ☕':'Rezept geladen. Brüh es nochmal ☕',

  /* Reaction chips (data/reactions.js) */
  'Great art':'Schöne Kunst',
  'Beautiful latte art':'Schöne Latte Art',
  'Nice spot':'Schöner Ort',
  'Lovely place to have it':'Schöner Ort dafür',
  'Unique coffee':'Besonderer Kaffee',
  'A coffee you don\'t see every day':'Ein Kaffee, den man nicht jeden Tag sieht',

  /* ---------- follow ---------- */
  'Follow':'Folgen',
  'Requested':'Angefragt',
  'Followers':'Follower',
  'Follow request sent to {who}':'Follower-Anfrage an {who} gesendet',
  'Request withdrawn':'Anfrage zurückgezogen',
  'Unfollowed':'Nicht mehr gefolgt',
  'That follow did not update':'Das Folgen wurde nicht aktualisiert',
  '{name} can see your pours now':'{name} sieht deine Kaffees jetzt',
  'You and {name} now follow each other':'Du und {name} folgt euch jetzt gegenseitig',
  'That did not go through. Try again.':'Das ging nicht durch. Probier es nochmal.',
  'Request declined':'Anfrage abgelehnt',
  'Not following anyone yet.':'Du folgst noch niemandem.',
  'Find people on Explore.':'Finde Leute unter Entdecken.',
  'No followers yet.':'Noch keine Follower.',
  'Share your pours to get discovered.':'Teil deine Kaffees, damit man dich findet.',
  'Loading…':'Wird geladen…',
  'Waiting on {name}':'Warten auf {name}',
  'Follow {name} to see their pours':'Folge {name}, um die Kaffees zu sehen',
  'They':'Diese Person',
  'Your request is in. The moment they accept, their pours and recipes show up here.':
    'Deine Anfrage ist raus. Sobald sie angenommen wird, erscheinen hier die Kaffees und Rezepte.',
  'Their pours, recipes and bio stay with the followers they have accepted.':
    'Kaffees, Rezepte und Bio bleiben bei den Followern, die angenommen wurden.',
  'Recent pours':'Neueste Kaffees',
  'No pours yet.':'Noch keine Kaffees.',

  /* ---------- notifications ---------- */
  '{time} ago':'vor {time}',
  'All caught up.':'Alles gelesen.',

  /* ---------- moderation ---------- */
  'Report this pour':'Diesen Kaffee melden',
  'Thanks for helping keep Crema kind. A person reads every report, and the author never finds out who sent it.':
    'Danke, dass du Crema freundlich hältst. Jede Meldung liest ein Mensch, und wer sie geschickt hat, erfährt die andere Seite nie.',
  'Spam or misleading':'Spam oder irreführend',
  'Harassment or hate':'Belästigung oder Hass',
  'Nudity or sexual content':'Nacktheit oder sexuelle Inhalte',
  'Violence or self-harm':'Gewalt oder Selbstverletzung',
  'Not their content':'Nicht ihr eigener Inhalt',
  'Something else':'Etwas anderes',
  'Reported. Thanks for keeping Crema kind 🙏':'Gemeldet. Danke, dass du Crema freundlich hältst 🙏',
  'That report did not send. Try again.':'Die Meldung ging nicht raus. Probier es nochmal.',
  'Block {who}? You will not see their pours, and they are never told.':
    '{who} blockieren? Du siehst die Kaffees nicht mehr, und die andere Seite erfährt nichts davon.',
  'Blocked {who}':'{who} blockiert',
  '{who} is already blocked':'{who} ist schon blockiert',
  'That block did not go through. Try again.':'Das Blockieren ging nicht durch. Probier es nochmal.',
  'Delete this pour? This cannot be undone.':'Diesen Kaffee löschen? Das lässt sich nicht rückgängig machen.',
  'Pour deleted':'Kaffee gelöscht',
  'That did not delete. The pour is still there.':'Das Löschen ging schief. Der Kaffee ist noch da.',

  /* ---------- cafés ---------- */
  'Opening city by city':'Stadt für Stadt',
  'The best coffee near you, from the people drinking it':'Der beste Kaffee in deiner Nähe, von denen, die ihn trinken',
  'Crema is people logging what they pour. Cafés are the other half of that, and they are being switched on one city at a time.':
    'Bei Crema tragen Leute ein, was sie machen. Cafés sind die andere Hälfte davon, und die schalten wir Stadt für Stadt frei.',
  'Own a café?':'Du hast ein Café?',
  'Get in before your street does.':'Sei vor deiner Straße dabei.',
  'We are opening Crema to a small first group of cafés. Pilot places are handled in the order they arrive, one city at a time, and the cafés in that first group decide with their feedback what gets built next.':
    'Wir öffnen Crema für eine kleine erste Gruppe von Cafés. Pilotplätze bearbeiten wir in der Reihenfolge, in der sie eingehen, Stadt für Stadt. Die Cafés aus dieser ersten Gruppe entscheiden mit ihrem Feedback, was als Nächstes gebaut wird.',
  'Your café, on the map':'Dein Café auf der Karte',
  'A page with the beans you pour and the machine you pull them on.':'Eine Seite mit den Bohnen, die du ausschenkst, und der Maschine dahinter.',
  'Every pour tagged to you':'Jeder Kaffee mit deinem Namen',
  'Someone photographs their flat white at your bar and your name is on it.':'Jemand fotografiert seinen Flat White an deiner Bar, und dein Name steht darunter.',
  'Regulars you can actually see':'Stammgäste, die du wirklich siehst',
  'People follow your café and see what gets poured there.':'Leute folgen deinem Café und sehen, was dort gemacht wird.',
  'An offer worth showing':'Ein Angebot, das man herzeigt',
  'Put something behind a posted pour: a discount, a filter on the house.':'Häng etwas an einen geposteten Kaffee: einen Rabatt, einen Filter aufs Haus.',
  'Ask for a pilot place':'Pilotplatz anfragen',
  'or write to':'oder schreib an',
  'tap to copy':'zum Kopieren tippen',
  'Tell us your café and your city, and we will come back to you when your city opens. It costs nothing during the pilot.':
    'Sag uns dein Café und deine Stadt, dann melden wir uns, sobald deine Stadt öffnet. Während des Pilotbetriebs kostet das nichts.',
  'Not an owner?':'Kein eigenes Café?',
  'Tell your favourite café about Crema. The ones people ask for get opened first.':
    'Erzähl deinem Lieblingscafé von Crema. Die Läden, nach denen gefragt wird, kommen zuerst dran.',
  'Share Crema':'Crema teilen',
  'Opening your mail app ✉️':'Dein Mailprogramm wird geöffnet ✉️',
  'Crema — café pilot':'Crema — Café-Pilot',
  'Hi Magnus,\n\nI would like to put my café on Crema.\n\nCafé:\nCity:\nWebsite / Instagram:\nWhat we pour:\n\nWhat I am most interested in:\n\nThanks!':
    'Hallo Magnus,\n\nich würde mein Café gern auf Crema bringen.\n\nCafé:\nStadt:\nWebsite / Instagram:\nWas wir ausschenken:\n\nWorauf ich am meisten Lust habe:\n\nDanke!',
  'Community pours here':'Kaffees aus der Community',
  'No pours tagged here yet. Be the first.':'Hier ist noch kein Kaffee getaggt. Mach den Anfang.',
  '10% off any drink':'10 % auf jedes Getränk',
  'Show any post tagged here at the counter.':'Zeig an der Theke einen Beitrag, der hier getaggt ist.',
  'Follow café':'Café folgen',
  'Directions':'Route',
  'Following café ☕':'Café gefolgt ☕',
  '{n} followers':'{n} Follower',
  '10% off · show post':'10 % Rabatt · Beitrag zeigen',
  'Latte art of the day':'Latte Art des Tages',

  /* ---------- profile ---------- */
  'Pours':'Kaffees',
  'Saved':'Gemerkt',
  'Badges':'Abzeichen',
  'Stats':'Statistik',
  'Add a bio in Settings':'Bio in den Einstellungen ergänzen',
  'Change your photo in Settings':'Foto in den Einstellungen ändern',
  'Level':'Level',
  '{n} points':'{n} Punkte',
  '{n} to {level}':'{n} bis {level}',
  'Top level reached':'Höchstes Level erreicht',
  'Tap ＋ to log your first coffee.':'Tipp auf ＋ und trag deinen ersten Kaffee ein.',
  'Loading your collection…':'Deine Sammlung wird geladen…',
  'Nothing saved yet.':'Noch nichts gemerkt.',
  'Tap the bookmark on any post.':'Tipp bei einem Beitrag auf das Lesezeichen.',
  'Recent activity':'Zuletzt gemacht',
  'Your last few weeks of coffee.':'Deine letzten Wochen Kaffee.',
  'last 3 weeks':'letzte 3 Wochen',
  'day streak':'Tage-Streak',
  'art styles':'Muster',
  '3 weeks ago':'vor 3 Wochen',
  'today':'heute',
  'Your journey starts here':'Hier fängt dein Weg an',
  'Every pour earns points and builds your streak, and enough of them move you up a level.':
    'Jeder Kaffee bringt Punkte und hält deine Streak am Leben. Genug davon, und du steigst ein Level auf.',
  'Log your first coffee':'Trag deinen ersten Kaffee ein',
  'Bean passport':'Bohnenpass',
  'See all':'Alle ansehen',
  'coffee beans':'Kaffeebohnen',
  '{n} bean':'{n} Bohne',
  '{n} beans':'{n} Bohnen',
  '{n} origin':'{n} Herkunft',
  '{n} origins':'{n} Herkünfte',
  'tap for details':'für Details tippen',
  'Your own coffee. Details are coming later.':'Dein eigener Kaffee. Details kommen später.',
  '{a} of {b} earned':'{a} von {b} verdient',

  /* ---------- stats ---------- */
  'No numbers yet.':'Noch keine Zahlen.',
  'Log a few coffees and this fills up on its own.':'Trag ein paar Kaffees ein, dann füllt sich das von allein.',
  'Your coffee':'Dein Kaffee',
  '{c} of {n} pour':'{c} von {n} Kaffee',
  '{c} of {n} pours':'{c} von {n} Kaffees',
  '{p}% of everything you log':'{p} % von allem, was du einträgst',
  'Other':'Andere',
  'coffees a day':'Kaffees am Tag',
  'pours logged':'Kaffees eingetragen',
  'day with coffee':'Tag mit Kaffee',
  'days with coffee':'Tage mit Kaffee',
  'best streak':'beste Streak',
  'Your rhythm':'Dein Rhythmus',
  'That is one day since your first pour, and about {w} a week.':'Das ist ein Tag seit deinem ersten Kaffee, also etwa {w} pro Woche.',
  'That is {n} days since your first pour, and about {w} a week.':'Das sind {n} Tage seit deinem ersten Kaffee, also etwa {w} pro Woche.',
  'Your biggest day was {n} coffees.':'Dein stärkster Tag waren {n} Kaffees.',
  'You are one day into a streak right now.':'Du bist gerade einen Tag in einer Streak.',
  'You are {n} days into a streak right now.':'Du bist gerade {n} Tage in einer Streak.',
  'When you pour':'Wann du Kaffee machst',
  'Most of your coffee happens around <b>{h}</b>.':'Die meisten deiner Kaffees machst du gegen <b>{h}</b>.',
  'Counted from the {n} pours that carry a recorded time.':'Gezählt aus den {n} Kaffees mit erfasster Uhrzeit.',
  'Most-poured coffee':'Meistgebrühter Kaffee',
  'Roaster you return to':'Rösterei, zu der du zurückkehrst',
  'Machine':'Maschine',
  'Milk':'Milch',
  'Latte art':'Latte Art',
  'Poured at a café':'Im Café gemacht',
  'What you brew with':'Womit du brühst',
  '{n} different coffees so far.':'Bisher {n} verschiedene Kaffees.',
  'You poured art on {p}% of your coffees.':'Bei {p} % deiner Kaffees hast du Art gegossen.',
  'Your espresso':'Dein Espresso',
  'average ratio':'Ratio im Schnitt',
  'dose in':'Einwaage',
  'yield out':'Auswaage',
  'shot time':'Bezugszeit',
  'From the one pour where you logged both dose and yield.':'Aus dem einen Kaffee, bei dem du Ein- und Auswaage notiert hast.',
  'From the {n} pours where you logged both dose and yield.':'Aus den {n} Kaffees, bei denen du Ein- und Auswaage notiert hast.',
  'Log a dose and a yield on your next pour, and your brew ratio shows up here.':
    'Trag beim nächsten Kaffee Ein- und Auswaage ein, dann steht deine Ratio hier.',

  /* Badges (domain/scoring.js) */
  'First pour':'Erster Kaffee',
  'Post your first coffee':'Poste deinen ersten Kaffee',
  'Week streak':'Wochen-Streak',
  '7 days of coffee in a row':'7 Tage Kaffee am Stück',
  'Rosetta groove':'Rosetta-Lauf',
  'Post 5 rosettas':'Poste 5 Rosetten',
  'Tulip time':'Tulpenzeit',
  'Post your first tulip':'Poste deine erste Tulpe',
  'Swan whisperer':'Schwanenflüsterer',
  'Post a swan':'Poste einen Schwan',
  'Bean explorer':'Bohnenforscher',
  'Log 7 different beans':'Trag 7 verschiedene Bohnen ein',
  'World tour':'Welttour',
  'Try coffees from 5 origins':'Probier Kaffees aus 5 Herkünften',
  'Cold brew curious':'Cold-Brew-neugierig',
  'Post a cold brew':'Poste einen Cold Brew',
  'Challenger':'Herausforderer',
  'Finish a challenge':'Schließ eine Challenge ab',
  'Regular winner':'Dauergewinner',
  'Finish 10 challenges':'Schließ 10 Challenges ab',
  'Century club':'Hunderterclub',
  'Log 100 pours':'Trag 100 Kaffees ein',

  /* ---------- levels & points ---------- */
  'Levels':'Level',
  'Levels & points':'Level & Punkte',
  'Your level grows as you post and practise. Think of it as a friendly marker of how far your craft has come. Nobody is grading you.':
    'Dein Level wächst, während du postest und übst. Sieh es als freundliche Markierung, wie weit dein Handwerk ist. Benotet wird hier niemand.',
  '{n} pts':'{n} Pkt.',
  '{n} points to Level {lvl} · {name}':'{n} Punkte bis Level {lvl} · {name}',
  'Top of the ladder. There is nothing left to climb.':'Ganz oben. Weiter geht es nicht.',
  'How points are earned':'Wofür es Punkte gibt',
  'The ladder':'Die Leiter',
  'you are here':'du bist hier',
  'start':'Start',
  'Each level costs about half again as much as the one before, and the names follow the classic latte-art progression: hearts, then tulips, then rosettas, then swans.':
    'Jedes Level kostet etwa die Hälfte mehr als das davor, und die Namen folgen dem klassischen Latte-Art-Weg: erst Herzen, dann Tulpen, dann Rosetten, dann Schwäne.',
  'A bean you\'ve never logged':'Eine Bohne, die du noch nie eingetragen hast',
  'An exact recipe · dose in, yield out':'Ein genaues Rezept · Einwaage, Auswaage',
  'Someone comments on your pour':'Jemand kommentiert deinen Kaffee',
  'Someone likes your pour':'Jemand liked deinen Kaffee',
  '1st place on today\'s podium':'1. Platz auf dem Podium des Tages',
  '2nd place on today\'s podium':'2. Platz auf dem Podium des Tages',
  '3rd place on today\'s podium':'3. Platz auf dem Podium des Tages',

  /* ---------- reminders & push ---------- */
  'Reminders':'Erinnerungen',
  'Add Crema to your Home Screen to get reminders: tap Share, then <b>Add to Home Screen</b>. Safari cannot send notifications from a browser tab on iPhone.':
    'Leg Crema auf deinen Home-Bildschirm, dann bekommst du Erinnerungen: auf Teilen tippen, dann <b>Zum Home-Bildschirm</b>. Aus einem Browser-Tab kann Safari auf dem iPhone keine Mitteilungen schicken.',
  'This browser cannot send notifications. The streak nudge still appears on Home when you open Crema.':
    'Dieser Browser kann keine Mitteilungen schicken. Der Streak-Hinweis erscheint trotzdem auf der Startseite, wenn du Crema öffnest.',
  'Notifications are switched off for Crema in your device settings. On Android: Settings, then Apps, then Crema, then Notifications. Turn them on there and this comes back.':
    'Mitteilungen sind für Crema in deinen Geräteeinstellungen aus. Auf Android: Einstellungen, dann Apps, dann Crema, dann Benachrichtigungen. Schalte sie dort ein, dann ist das hier wieder da.',
  'Notifications are blocked for Crema in your browser settings. Allow them there and this comes back.':
    'Mitteilungen sind für Crema in deinen Browsereinstellungen blockiert. Erlaube sie dort, dann ist das hier wieder da.',
  'A nudge in the morning to log today\'s coffee, and one in the evening if your streak is about to lapse. Nothing else unless you ask for it.':
    'Ein Hinweis am Morgen, den heutigen Kaffee einzutragen, und einer am Abend, wenn deine Streak zu reißen droht. Sonst nichts, außer du willst es.',
  'Remind me':'Erinnere mich',
  'Morning coffee nudge':'Morgen-Erinnerung',
  'If you have not logged one yet that day':'Wenn du an dem Tag noch keinen eingetragen hast',
  'Likes, comments &amp; follows':'Likes, Kommentare &amp; Follower',
  'When someone reacts to your coffee':'Wenn jemand auf deinen Kaffee reagiert',
  'Streak reminder':'Streak-Erinnerung',
  'Evenings, only when your streak is at risk':'Abends, nur wenn deine Streak in Gefahr ist',
  'Sunday at 4pm, when your card is ready':'Sonntag um 16 Uhr, wenn deine Karte fertig ist',
  'Sunday afternoon, if you poured that week':'Sonntagnachmittag, wenn du in der Woche Kaffee gemacht hast',
  'Turn off on this device':'Auf diesem Gerät ausschalten',
  'Reminders on ☕':'Erinnerungen an ☕',
  'Reminders off on this device':'Erinnerungen auf diesem Gerät aus',
  'Notifications are blocked in your browser settings':'Mitteilungen sind in deinen Browsereinstellungen blockiert',
  'Add Crema to your Home Screen first':'Leg Crema zuerst auf deinen Home-Bildschirm',
  'No reminders. You can turn them on any time.':'Keine Erinnerungen. Du kannst sie jederzeit einschalten.',
  'Reminders would not turn on. Try again.':'Die Erinnerungen ließen sich nicht einschalten. Probier es nochmal.',

  /* ---------- bean passport ---------- */
  '{n} bean tried':'{n} Bohne probiert',
  '{n} beans tried':'{n} Bohnen probiert',
  'Your own coffee':'Dein eigener Kaffee',
  'not logged yet':'noch nicht eingetragen',
  'Every coffee you have logged, most-poured first.':'Jeder Kaffee, den du eingetragen hast, der meistgebrühte zuerst.',
  'No beans yet.':'Noch keine Bohnen.',
  'Add the coffee you used when you log a pour and it lands here.':'Trag beim Eintragen den Kaffee ein, den du benutzt hast, dann landet er hier.',
  'Tasting notes':'Aromen',
  'Details':'Details',
  'Origin':'Herkunft',
  'Roast level':'Röstgrad',
  'Availability':'Erhältlich',
  'Sold in Germany':'In Deutschland erhältlich',
  'Roasted in Germany':'In Deutschland geröstet',
  'Your pours with this bean':'Deine Kaffees mit dieser Bohne',
  'No pours logged with this bean yet.':'Mit dieser Bohne ist noch kein Kaffee eingetragen.',
  'No details for that bean yet':'Zu dieser Bohne gibt es noch keine Details',

  /* Origin countries (data/catalog.js flags) */
  'Ethiopia':'Äthiopien','Colombia':'Kolumbien','Brazil':'Brasilien','Kenya':'Kenia',
  'Indonesia':'Indonesien','Rwanda':'Ruanda','Germany':'Deutschland','Italy':'Italien',
  'United Kingdom':'Vereinigtes Königreich','Norway':'Norwegen','Denmark':'Dänemark',

  /* ---------- settings ---------- */
  'Account':'Konto',
  'Name':'Name',
  'Bio':'Bio',
  'Say a little about your coffee…':'Erzähl ein bisschen über deinen Kaffee…',
  'Save profile':'Profil speichern',
  'Appearance':'Darstellung',
  'Auto':'Automatisch',
  'Light':'Hell',
  'Dark':'Dunkel',
  'About':'Über',
  'How levels work':'Wie Level funktionieren',
  'How streaks work':'Wie Streaks funktionieren',
  'Legal':'Rechtliches',
  'Change photo':'Foto ändern',
  'Add a photo':'Foto hinzufügen',
  'Remove':'Entfernen',
  'Uploading…':'Wird hochgeladen…',
  'Optional. Initials work fine.':'Optional. Initialen reichen völlig.',
  'Add your name first':'Trag zuerst deinen Namen ein',
  'Profile updated ✓':'Profil aktualisiert ✓',
  'Saved here. We will sync it shortly.':'Hier gespeichert. Wir gleichen es gleich ab.',
  'Saved on this device. We will sync your profile shortly.':'Auf diesem Gerät gespeichert. Wir gleichen dein Profil gleich ab.',
  'Your profile did not load. We will try again next time.':'Dein Profil wurde nicht geladen. Wir versuchen es beim nächsten Mal wieder.',
  'That did not save. Try again.':'Das wurde nicht gespeichert. Probier es nochmal.',
  'Photo added 📸':'Foto hinzugefügt 📸',
  'Drag the photo to pick what stays in the square.':'Zieh das Foto, um zu wählen, was im Quadrat bleibt.',
  'Photo updated 📸':'Foto aktualisiert 📸',
  'Back to your initials':'Zurück zu deinen Initialen',
  'That file is not an image':'Diese Datei ist kein Bild',
  'That image could not be read':'Dieses Bild ließ sich nicht lesen',
  'That file could not be read':'Diese Datei ließ sich nicht lesen',
  'That photo did not upload. Try again.':'Das Foto wurde nicht hochgeladen. Probier es nochmal.',
  'That photo did not upload. Tap Post to retry.':'Das Foto wurde nicht hochgeladen. Tipp auf Posten, um es nochmal zu versuchen.',
  'That is a lot of photos at once. Give it a minute.':'Das sind gerade viele Fotos auf einmal. Warte kurz.',
  'That photo did not come off. Try again.':'Das Foto ließ sich nicht entfernen. Probier es nochmal.',
  'Profile photos are not switched on yet':'Profilfotos sind noch nicht freigeschaltet',

  /* ---------- premium ---------- */
  'Crema Premium':'Crema Premium',
  'Premium active':'Premium aktiv',
  'Free for now. We will ask you before anything costs money.':'Vorerst kostenlos. Wir fragen dich, bevor irgendetwas Geld kostet.',
  'Turn Premium off':'Premium ausschalten',
  'Free right now, while Crema is young — no card, no trial countdown, no price to compare. It needs a code, and the codes are being handed out by hand. That will not last: when billing starts, this window shuts.':
    'Gerade kostenlos, solange Crema jung ist — keine Karte, kein Countdown, kein Preis zum Vergleichen. Du brauchst nur einen Code, und die vergeben wir von Hand. Das bleibt nicht so: Sobald abgerechnet wird, schließt sich das Fenster.',
  'Logging your coffee stays free for everyone, always, whatever the drink, the machine or the bean.':
    'Deinen Kaffee einzutragen bleibt für alle kostenlos, immer, egal welches Getränk, welche Maschine, welche Bohne.',
  'Pin your gear & coffees':'Gear & Kaffees anpinnen',
  'Hold the ones you use at the top of every picker':'Halt die, die du nutzt, in jeder Liste ganz oben',
  'Name your own drink types':'Eigene Getränke benennen',
  'Ristretto, Bombón, whatever you actually order':'Ristretto, Bombón, was auch immer du wirklich bestellst',
  'Your week in coffee':'Deine Kaffeewoche',
  'A card of your week, made to post':'Eine Karte deiner Woche, gemacht zum Posten',
  'Your stats':'Deine Zahlen',
  'What you actually brew, when, and at what ratio':'Was du wirklich brühst, wann, und in welchem Verhältnis',
  'The gold ring':'Der goldene Ring',
  'Your avatar wears it everywhere you appear':'Dein Bild trägt ihn überall, wo du auftauchst',
  'Always ad-free':'Immer werbefrei',
  'Whatever Crema does later, not to you':'Was Crema später auch macht — bei dir nicht',
  '<b>{what}</b> is Premium — <u>free right now, with a code</u>.':
    '<b>{what}</b> ist Premium — <u>gerade kostenlos, mit einem Code</u>.',
  '<b>{what}</b> is part of Premium.':'<b>{what}</b> gehört zu Premium.',
  'Naming a drink of your own':'Ein eigenes Getränk zu benennen',
  'Pinning your gear':'Dein Gear anzupinnen',
  'Premium unlocked ✦':'Premium freigeschaltet ✦',
  'Premium turned off':'Premium ausgeschaltet',
  'Not now':'Jetzt nicht',
  'Premium':'Premium',
  'Sign in for Premium':'Melde dich an für Premium',
  'Premium lives on your account, so it needs one. Creating it is free, and so is Premium right now.':
    'Premium hängt an deinem Konto, also braucht es eins. Das Konto ist kostenlos, und Premium gerade auch.',
  'Sign in first — Premium lives on your account.':'Melde dich zuerst an — Premium hängt an deinem Konto.',
  /* the code */
  'Activation code':'Freischaltcode',
  'Type it exactly as it came':'Tipp ihn genau so ein, wie du ihn bekommen hast',
  'Unlock':'Freischalten',
  'Checking…':'Wird geprüft…',
  'No code yet?':'Noch keinen Code?',
  'Write to {mail}':'Schreib an {mail}',
  'and you get one back. One line is enough.':'und du bekommst einen zurück. Eine Zeile reicht.',
  'or tap to copy the address':'oder tippen, um die Adresse zu kopieren',
  'Crema Premium code':'Crema-Premium-Code',
  'Type the code you were sent.':'Tipp den Code ein, den du bekommen hast.',
  'That code is not right. Check it against the mail, or ask for a new one.':
    'Der Code stimmt nicht. Vergleich ihn mit der Mail, oder frag nach einem neuen.',
  'That did not go through. Check your connection and try again.':
    'Das ging nicht durch. Prüf deine Verbindung und probier es nochmal.',
  '{mail} copied ✉️':'{mail} kopiert ✉️',
  /* the week card */
  'YOUR WEEK IN COFFEE':'DEINE KAFFEEWOCHE',
  'coffee, logged':'Kaffee, eingetragen',
  'coffees, logged':'Kaffees, eingetragen',
  'on {a} of 7 days':'an {a} von 7 Tagen',
  'No coffee logged this week.':'Diese Woche kein Kaffee eingetragen.',
  'This card covers one Monday to Sunday, and lands every Sunday at 4pm.':
    'Diese Karte zeigt eine Woche von Montag bis Sonntag — und kommt jeden Sonntag um 16 Uhr.',
  'This week is still running — the card counts every pour until midnight.':
    'Die Woche läuft noch — die Karte zählt jeden Kaffee bis Mitternacht.',
  '{n} pour on {d} of 7 days — your week, as a card you can post':
    '{n} Kaffee an {d} von 7 Tagen — deine Woche, als Karte zum Posten',
  '{n} pours on {d} of 7 days — your week, as a card you can post':
    '{n} Kaffees an {d} von 7 Tagen — deine Woche, als Karte zum Posten',
  /* the four numbers */
  'your usual':'dein Üblicher',
  '{n} of your {total} pours':'{n} von {total} Tassen',
  'coffee o’clock':'Kaffeezeit',
  'your usual time this week':'deine übliche Zeit diese Woche',
  'ahead of':'weiter als',
  'of everyone pouring this week':'aller, die diese Woche brühen',
  'the response':'die Resonanz',
  'likes & comments this week':'Likes & Kommentare diese Woche',
  /* the standouts */
  'The three you want shown':'Die drei, die groß rauskommen',
  '{n} of {max}':'{n} von {max}',
  'Tap to swap one out.':'Tippen, um eine zu tauschen.',
  'Your most-loved three, until you pick your own.':
    'Deine drei beliebtesten, bis du eigene wählst.',
  'Pour':'Kaffee',
  'best run':'beste Serie',
  'busiest day':'stärkster Tag',
  'in one day':'an einem Tag',
  '{n} new that week':'{n} neu in der Woche',
  'the bag':'die Tüte',
  'latte art':'Latte Art',
  'poured out':'auswärts',
  'at a café':'im Café',
  '{n}×':'{n}×',
  '{name} on Crema':'{name} auf Crema',
  'Share your week':'Teil deine Woche',
  'Saves as a picture, sized for a post or a story. Nothing leaves Crema until you send it.':
    'Wird als Bild gespeichert, passend für Post oder Story. Nichts verlässt Crema, bevor du es verschickst.',
  'Saved as a picture 📸':'Als Bild gespeichert 📸',
  'That card would not save. Try again.':'Die Karte ließ sich nicht speichern. Probier es nochmal.',
  'Open':'Öffnen',
  /* the locked stats tab */
  'The rest of your numbers are Premium':'Der Rest deiner Zahlen ist Premium',
  'Your rhythm, the hour you pour at, your machine and milk, your brew ratio, your week and your shelf.':
    'Dein Rhythmus, deine Uhrzeit, Maschine und Milch, dein Brühverhältnis, deine Woche und dein Regal.',
  'Free right now, with a code':'Gerade kostenlos, mit einem Code',
  'Pin the ones you use most to hold them at the top. That is Premium, <u>free right now, with a code</u>.':
    'Pinn die an, die du am meisten nutzt, dann bleiben sie oben. Das ist Premium, <u>gerade kostenlos, mit einem Code</u>.',
  'Pinned to the top 📌':'Nach oben gepinnt 📌',
  'Unpinned':'Nicht mehr gepinnt',
  'Pin to the top':'Nach oben pinnen',
  'Unpin':'Nicht mehr pinnen',

  'this week':'diese Woche',
  '{d} is your biggest coffee day.':'{d} ist dein stärkster Kaffeetag.',

  /* ---------- pickers ---------- */
  'Machine / brewer':'Maschine / Brüher',
  'Machine or brewer':'Maschine oder Brüher',
  'Search machines & brewers…':'Maschinen & Brüher suchen…',
  'Coffee / beans':'Kaffee / Bohnen',
  'Search coffees, or add yours…':'Kaffees suchen oder eigenen hinzufügen…',
  'Your own':'Deine eigene',
  'Change':'Ändern',
  'Choose a machine':'Maschine wählen',
  'Choose a coffee':'Kaffee wählen',
  'Search {n} machines & brewers':'{n} Maschinen & Brüher durchsuchen',
  'Search {n} coffees':'{n} Kaffees durchsuchen',
  '{n} match':'{n} Treffer',
  '{n} matches':'{n} Treffer',
  'Add “{q}”':'„{q}“ hinzufügen',
  'None of these? Save it as your own machine':'Nichts davon? Speicher sie als deine eigene Maschine',
  'None of these? Save it as your own coffee':'Nichts davon? Speicher ihn als deinen eigenen Kaffee',
  'Not in the list. Save it as your own machine':'Nicht in der Liste. Speicher sie als deine eigene Maschine',
  'Not in the list. Save it as your own coffee':'Nicht in der Liste. Speicher ihn als deinen eigenen Kaffee',
  'Nothing in the catalogue matches that. Yours works just as well: it lands on your gear and is there next time.':
    'Im Katalog passt dazu nichts. Deine tut es genauso: Sie landet bei deinem Gear und ist beim nächsten Mal da.',
  'Nothing in the catalogue matches that. Yours works just as well: it lands on your shelf and is there next time.':
    'Im Katalog passt dazu nichts. Deiner tut es genauso: Er landet in deinem Regal und ist beim nächsten Mal da.',
  'Yours':'Deine',
  'most recent first':'zuletzt genutzte zuerst',
  'Common ones':'Häufige',
  'Popular':'Beliebt',
  'Browse by brand':'Nach Marke stöbern',
  'Browse by roaster':'Nach Rösterei stöbern',
  'Not on the list?':'Nicht in der Liste?',
  'Type it above and add it as your own':'Tipp es oben ein und füg es als eigenes hinzu',
  'Clear this field':'Feld leeren',

  /* ---------- create / edit ---------- */
  'Edit coffee':'Kaffee bearbeiten',
  'your coffee photo':'dein Kaffeefoto',
  'Upload failed':'Upload fehlgeschlagen',
  'That photo could not reach the server. Tap Post to try again, or drop it and post without a photo.':
    'Das Foto hat den Server nicht erreicht. Tipp auf Posten, um es nochmal zu versuchen, oder lass es weg und poste ohne Foto.',
  'Post without the photo':'Ohne Foto posten',
  'The photo stays as it was poured. Everything else is yours to fix.':'Das Foto bleibt, wie es war. Alles andere kannst du ändern.',
  'Retake':'Neu aufnehmen',
  'Take photo':'Foto aufnehmen',
  'Gallery':'Galerie',
  'Drink':'Getränk',
  'Your drink':'Dein Getränk',
  'e.g. Ristretto':'z. B. Ristretto',
  'only if you poured one, tap to toggle':'nur wenn du eins gegossen hast, zum Umschalten tippen',
  'Heart':'Herz',
  'Rosetta':'Rosetta',
  'Tulip':'Tulpe',
  'Swan':'Schwan',
  'Abstract art':'Abstrakt',
  'No art? Leave these alone and your {drink} posts without a pattern.':
    'Keine Art? Lass die hier einfach, dann geht dein {drink} ohne Muster raus.',
  'Where did you have it?':'Wo hattest du ihn?',
  'I made it':'Selbst gemacht',
  'At a café':'Im Café',
  'Café':'Café',
  'Choose a café…':'Café wählen…',
  'Optional':'Optional',
  'Caption':'Text',
  'Say something about this coffee…':'Sag etwas über diesen Kaffee…',
  'Who can see this':'Wer das sehen kann',
  'Everyone':'Alle',
  'Followers only':'Nur Follower',
  'Appears in Today, where anyone can find it.':'Erscheint unter Heute, wo ihn alle finden können.',
  'Only the followers you have accepted can see it, and it never appears in Today.':
    'Nur die Follower, die du angenommen hast, sehen ihn, und unter Heute taucht er nie auf.',
  '{cafe}\'s setup':'Setup von {cafe}',
  'what they are pouring':'was sie ausschenken',
  'Bean':'Bohne',
  'Which bean did you have?':'Welche Bohne hattest du?',
  'Your pour will be tagged 📍 {cafe}':'Dein Kaffee wird mit 📍 {cafe} getaggt',
  'Pick a café above to load the beans and gear they use.':'Wähl oben ein Café, dann laden wir dessen Bohnen und Gear.',
  'optional, add only what you know':'optional, trag nur ein, was du weißt',
  'Dose in':'Einwaage',
  'Yield out':'Auswaage',
  'Time':'Zeit',
  'Temp':'Temp.',
  'Save changes':'Änderungen speichern',
  'The photo is still uploading. One moment.':'Das Foto lädt noch hoch. Einen Moment.',
  'The photo still will not upload. Remove it to post without one.':'Das Foto lädt immer noch nicht hoch. Nimm es raus, um ohne zu posten.',
  'Posted. Streak kept 🔥':'Gepostet. Streak gehalten 🔥',
  'Posted ☕ · add a photo next time':'Gepostet ☕ · nächstes Mal mit Foto',
  'That did not post. Check your connection and try again.':'Das ging nicht raus. Prüf deine Verbindung und probier es nochmal.',
  'That was a lot of coffee at once. Give it a minute.':'Das war gerade viel Kaffee auf einmal. Warte kurz.',
  'Changes saved':'Änderungen gespeichert',
  'That did not save. The pour is unchanged.':'Das wurde nicht gespeichert. Der Kaffee ist unverändert.',
  'Pours can only be edited on the day you posted them':'Kaffees lassen sich nur an dem Tag bearbeiten, an dem du sie gepostet hast',
  'That pour is gone':'Diesen Kaffee gibt es nicht mehr',
  'That pour would not open':'Dieser Kaffee ließ sich nicht öffnen',

  /* ---------- search ---------- */
  'Results for “{q}”':'Ergebnisse für „{q}“',
  'Clear':'Zurücksetzen',
  'yours':'deiner',
  'No matches for “{q}”.':'Keine Treffer für „{q}“.',
  'Try a name, a bean, a café or a drink.':'Probier einen Namen, eine Bohne, ein Café oder ein Getränk.',


  /* ---------- beans & machines: the detail sheets, the passports
                and the picker (2026-08-18) ----------
     Machine and bean NAMES stay English, as always — they are values
     written to the database. What is translated is everything Crema
     says *about* them. */
  'Type':'Art',
  'Brand':'Marke',
  'How it brews':'Wie sie brüht',
  'Roaster':'Rösterei',
  'Note':'Notiz',
  'Not sure':'Weiß ich nicht',
  'as the roaster describes it':'wie die Rösterei ihn beschreibt',
  'True of every {brand} of this kind. Crema does not hold specs for individual models.':
    'Gilt für jede {brand} dieser Art. Crema speichert keine Daten zu einzelnen Modellen.',
  'The catalogue has no details for this coffee yet.':'Zu diesem Kaffee hat der Katalog noch keine Details.',
  'The catalogue has no details for this machine yet.':'Zu dieser Maschine hat der Katalog noch keine Details.',
  'Nothing written down about this coffee yet — it is yours, so nobody else can fill it in.':
    'Zu diesem Kaffee steht noch nichts — er gehört dir, also kann das niemand sonst ausfüllen.',
  'Nothing written down about this brewer yet — it is yours, so nobody else can fill it in.':
    'Zu dieser Maschine steht noch nichts — sie gehört dir, also kann das niemand sonst ausfüllen.',
  'You brew it on':'Du brühst ihn auf',
  'You brew with':'Du brühst damit',
  'Your pours with this coffee':'Deine Kaffees mit dieser Bohne',
  'Your pours on this machine':'Deine Kaffees auf dieser Maschine',
  'No pours logged on this machine yet.':'Auf dieser Maschine ist noch kein Kaffee eingetragen.',
  'Your own machine':'Deine eigene Maschine',

  /* what a machine is — MACHINE_KINDS in data/catalog.js */
  'Espresso machine':'Espressomaschine',
  'Bean-to-cup':'Kaffeevollautomat',
  'Lever espresso machine':'Handhebelmaschine',
  'Manual espresso press':'Handpresse',
  'Portable espresso maker':'Espresso für unterwegs',
  'Moka pot':'Espressokocher',
  'Pour-over dripper':'Handfilter',
  'French press':'French Press',
  'Filter coffee brewer':'Filterkaffeemaschine',
  'Immersion brewer':'Immersionsbrüher',
  'Pump pressure, around 9 bar':'Pumpendruck, etwa 9 bar',
  'Grinds, doses and brews at a button':'Mahlt, dosiert und brüht auf Knopfdruck',
  'Pressure by hand, on a piston':'Druck von Hand, über einen Kolben',
  'Pressure by hand, no electricity':'Druck von Hand, ganz ohne Strom',
  'Hand-pumped, made to travel':'Von Hand gepumpt, für unterwegs',
  'Steam pressure, on the stove':'Dampfdruck, auf dem Herd',
  'Gravity, poured by hand':'Schwerkraft, von Hand aufgegossen',
  'Full immersion, then pressed':'Alles zieht mit, dann gepresst',
  'Gravity, poured for you':'Schwerkraft, der Aufguss läuft automatisch',
  'Steeped, then pushed through a filter':'Ziehen lassen, dann durch den Filter drücken',
  'Steam wand':'Dampflanze',
  'Built in, varies by model':'Eingebaut, je nach Modell',
  'None':'Keine',

  /* roast levels — 'Light' and 'Dark' are already above, for the theme,
     and read correctly here too */
  'Medium':'Mittel',
  'Light-medium':'Hell bis mittel',
  'Medium-dark':'Mittel bis dunkel',

  /* more of the countries in data/catalog.js, now that a machine names
     where its brand is from */
  'Australia':'Australien','Japan':'Japan','USA':'USA','Netherlands':'Niederlande',
  'Canada':'Kanada','Switzerland':'Schweiz','Spain':'Spanien','Hong Kong':'Hongkong',
  'China':'China','Sweden':'Schweden','Finland':'Finnland','Portugal':'Portugal',
  'Belgium':'Belgien','India':'Indien','Vietnam':'Vietnam','Turkey':'Türkei',
  'Peru':'Peru','Guatemala':'Guatemala','Costa Rica':'Costa Rica','France':'Frankreich',

  /* ---------- the machine passport ---------- */
  'Machine passport':'Maschinenpass',
  '{n} brewer':'{n} Maschine',
  '{n} brewers':'{n} Maschinen',
  '{n} kind':'{n} Art',
  '{n} kinds':'{n} Arten',
  'No brewers yet.':'Noch keine Maschinen.',
  'Name the machine you used when you log a pour and it lands here.':
    'Trag beim Posten die Maschine ein, dann landet sie hier.',
  'Every brewer you have logged, most-poured first.':
    'Jede Maschine, die du eingetragen hast — die meistgenutzte zuerst.',
  'Most of your coffee comes off the {name}.':'Der meiste Kaffee kommt aus der {name}.',
  'espresso machine':'Espressomaschine',

  /* ---------- your own details (Premium) ---------- */
  'Your own bean and machine details':'Eigene Angaben zu Bohnen und Maschinen',
  'Details for your own coffee':'Details zu deinem eigenen Kaffee',
  'Details for your own machine':'Details zu deiner eigenen Maschine',
  'Your private note':'Deine private Notiz',
  'Your note':'Deine Notiz',
  '＋ Add details':'＋ Details ergänzen',
  '＋ Add a private note':'＋ Private Notiz',
  'Edit these details':'Details bearbeiten',
  'This one is yours. What you write here stays on your device and shows up on this page and in your passport — nobody else sees it, and nobody else can pick this entry.':
    'Der Eintrag gehört dir. Was du hier schreibst, bleibt auf deinem Gerät und steht auf dieser Seite und in deinem Pass — niemand sonst sieht es, und niemand sonst kann diesen Eintrag auswählen.',
  'This coffee or machine is in the catalogue, so its facts stay as they are. Your note is yours alone.':
    'Dieser Kaffee bzw. diese Maschine steht im Katalog, die Angaben bleiben also, wie sie sind. Deine Notiz gehört nur dir.',
  'Who roasted it':'Wer sie geröstet hat',
  'e.g. Ethiopia · Sidama, or Blend':'z. B. Äthiopien · Sidama, oder Blend',
  'Chocolate, red berry, caramel':'Schokolade, rote Beere, Karamell',
  'Grind setting, what it likes, what it hates…':'Mahlgrad, was sie mag, was sie nicht mag…',
  'Where you bought it, what it cost, how you dial it in…':
    'Wo du sie gekauft hast, was sie gekostet hat, wie du sie einstellst…',
  'Saved ✓':'Gespeichert ✓',

  /* ---------- the picker ---------- */
  'Favourites':'Favoriten',
  'Three photos on a pour':'Drei Fotos pro Kaffee',
  'The shot and the cup, not one or the other':'Der Shot und die Tasse, nicht nur eins davon',
  'Your own bean & machine details':'Eigene Angaben zu Bohnen & Maschinen',
  'Fill in the coffees and gear you added yourself':'Ergänze die Kaffees und Maschinen, die du selbst eingetragen hast',
  'Also yours':'Auch deine',
  'Add to favourites':'Zu den Favoriten',
  'Remove from favourites':'Aus den Favoriten',
  'Added to favourites ★':'Zu den Favoriten ★',
  'Removed from favourites':'Aus den Favoriten entfernt',
  'Star the ones you use most to hold them at the top. That is Premium, <u>free right now, with a code</u>.':
    'Markier die, die du am meisten nutzt — die bleiben oben. Das ist Premium, <u>gerade kostenlos, mit einem Code</u>.',
  'Search all {n} machines & brewers':'Alle {n} Maschinen & Brüher durchsuchen',
  'Search all {n} coffees':'Alle {n} Kaffees durchsuchen',
  'By brand, model or kind — “moka”, “silvia”, “bean-to-cup”. Not there? Add your own.':
    'Nach Marke, Modell oder Art — „moka“, „silvia“, „Vollautomat“. Nicht dabei? Trag deine eigene ein.',
  /* The examples are deliberately NOT translated word for word: origins
     and tasting notes are English strings in the catalogue itself, so
     „fruchtig“ would find nothing and teach the wrong lesson about the
     search. Brand and name work in every language, so the German hint
     leads with those. */
  'By name, roaster, origin or taste — “lidl”, “ethiopia”, “fruity”. Not there? Add your own.':
    'Nach Name, Rösterei oder Herkunft — „lidl“, „jacobs“, „espresso“. Nicht dabei? Trag deinen eigenen ein.',

  /* ---------- more than one photo (Premium) ---------- */
  'Up to three photos on a pour':'Bis zu drei Fotos pro Kaffee',
  'Up to three photos on a pour is Premium — <u>free right now, with a code</u>.':
    'Bis zu drei Fotos pro Kaffee ist Premium — <u>gerade kostenlos, mit einem Code</u>.',
  'Add up to three. The first stays the cover.':'Bis zu drei. Das erste bleibt das Titelbild.',
  'The first photo is the cover — it is the one the feed, your grid and the link preview show.':
    'Das erste Foto ist das Titelbild — es steht im Feed, in deinem Raster und in der Linkvorschau.',
  'Cover':'Titel',
  'Photo {n}':'Foto {n}',
  'Add another photo':'Noch ein Foto',
  'Remove this photo':'Dieses Foto entfernen',
  'Three photos is the most a pour can carry':'Mehr als drei Fotos gehen nicht',
  'A photo still will not upload. Remove it to post without it.':
    'Ein Foto lädt immer noch nicht hoch. Nimm es raus, dann geht der Post ohne.',
  'The photos stay as they were poured. Everything else is yours to fix.':
    'Die Fotos bleiben, wie sie waren. Alles andere kannst du ändern.',

  /* ---------- add to the Home Screen (iOS) ---------- */
  'Add Crema to your Home Screen':'Crema zum Home-Bildschirm hinzufügen',
  'Put Crema on your Home Screen':'Crema auf den Home-Bildschirm',
  'It opens full screen, with its own icon — and on an iPhone it is the only way Crema can remind you about your streak.':
    'Dann öffnet es sich im Vollbild, mit eigenem Icon — und auf dem iPhone ist das der einzige Weg, wie Crema dich an deinen Streak erinnern kann.',
  'Tap <b>Share</b> at the bottom of Safari':'Unten in Safari auf <b>Teilen</b> tippen',
  'Scroll down and tap <b>Add to Home Screen</b>':'Runterscrollen und auf <b>Zum Home-Bildschirm</b> tippen',
  'Tap <b>Add</b>. That is it.':'Auf <b>Hinzufügen</b> tippen. Das war\'s.',
  'Maybe later':'Später vielleicht',

  /* ---------- first in Crema (step-1.30, corrected by step-1.31) ---------- */
  'First coffee in Crema today':'Erster Kaffee heute in Crema',
  'First coffee in Crema wins the morning':'Der erste Kaffee in Crema gewinnt den Morgen',
  'Every day, the very first coffee logged in the whole app pays {n} points towards your level. One a day, for one person. Log yours early enough and it is yours.':'Jeden Tag bringt der allererste Kaffee, der in der ganzen App eingetragen wird, {n} Punkte für dein Level. Einer pro Tag, für eine Person. Trag deinen früh genug ein, und er gehört dir.',
  'And you will hear about it when someone you follow logs their first coffee of the day. You can turn that off in Settings.':'Und du erfährst es, wenn jemand, dem du folgst, seinen ersten Kaffee des Tages einträgt. In den Einstellungen kannst du das ausschalten.',
  'And you will hear about it whenever someone you follow logs a coffee. You can turn that off in Settings.':'Und du erfährst es, sobald jemand, dem du folgst, einen Kaffee einträgt. In den Einstellungen kannst du das ausschalten.',
  'Got it':'Alles klar',
  'When friends pour':'Wenn Freunde Kaffee machen',
  'Their first coffee of the day, once a morning':'Ihr erster Kaffee des Tages, einmal pro Morgen',
  'Every coffee they log':'Jeder Kaffee, den sie eintragen',
  /* The bodies of the inbox rows themselves, written in English by
     notify_on_daily_first() and notify_daily_champion() in
     platform/supabase/step-1.31.sql and translated on the way out — the
     server has no idea which language the reader picked. The champion
     line carries a {n} the server has already filled in, so it is
     matched here as literal text with the number in place; keep the
     award at 20 in crema_first_pour_points() or add the new wording. */
  'poured the first coffee of the day':'hat den ersten Kaffee des Tages gemacht',
  'First coffee in Crema today · +20 points':'Erster Kaffee heute in Crema · +20 Punkte',


  /* ============================================================
     Catalogue values — the words the app WRITES DOWN.

     These are translated for the eye only. Everything here is stored in
     the database in its English form and matched against later, so the
     value never changes with the language: a <select> carries the
     English string in `value` and shows the German one as its label
     (see selectOptions() in ui/components.js), and a stored "Oat" is
     read back through t() wherever it is shown. Switching language
     therefore cannot split anyone's stats, which is what kept these
     untranslated until now.

     Proper nouns stay put: machine brands and models, roasters, the
     names of individual coffees, and the latte-art vocabulary the
     German scene already uses in English (Rosetta, Tulip, Latte Art).
     ============================================================ */

  /* ---------- drinks (only the ones German says differently) ---------- */
  'Flat white':'Flat White',
  'Long black':'Long Black',
  'Pour-over':'Handfilter',
  'Filter':'Filterkaffee',
  'Cold brew':'Cold Brew',
  'Aeropress':'AeroPress',
  'Iced latte':'Iced Latte',
  '＋ Add your own drink…':'＋ Eigenes Getränk hinzufügen…',

  /* ---------- milk ---------- */
  'Whole milk':'Vollmilch',
  'Semi-skimmed':'Fettarme Milch',
  'Skimmed':'Magermilch',
  'Lactose-free':'Laktosefrei',
  'Oat':'Hafer',
  'Barista oat':'Barista-Hafer',
  'Almond':'Mandel',
  'Soy':'Soja',
  'Coconut':'Kokos',

  /* ---------- levels ---------- */
  'First Sips':'Erste Schlucke',
  'Steam Dreams':'Dampfträume',
  'Heart Starter':'Herzanfänger',
  'Heart Artist':'Herzkünstler',
  'Tulip Tinkerer':'Tulpenbastler',
  'Rosetta Artist':'Rosetta-Künstler',
  'Rosetta Pro':'Rosetta-Profi',
  'Swan Apprentice':'Schwanenlehrling',
  'Swan Master':'Schwanenmeister',
  'Latte Legend':'Latte-Legende',

  /* ---------- what a coffee is: origin lines ---------- */
  'Blend':'Blend',
  'Single origin':'Single Origin',
  'Fairtrade blend':'Fairtrade-Blend',
  'Organic blend':'Bio-Blend',
  'Fairtrade organic blend':'Fairtrade-Bio-Blend',
  'Seasonal':'Saisonal',
  'Seasonal single origin':'Saisonaler Single Origin',
  'Single origin, seasonal':'Single Origin, saisonal',
  'Blend, fine-ground':'Blend, fein gemahlen',
  'Colombia · Ethiopia blend':'Kolumbien · Äthiopien Blend',
  'Ethiopia · Sidama':'Äthiopien · Sidama',
  'Costa Rica · Tarrazú':'Costa Rica · Tarrazú',
  'Vietnam · Robusta blend':'Vietnam · Robusta-Blend',
  'India · Chikmagalur':'Indien · Chikmagalur',
  'Latin America · East Africa blend':'Lateinamerika · Ostafrika Blend',

  /* ---------- tasting notes, as the roaster claims them ---------- */
  'Bold':'Kräftig',
  'Chocolate':'Schokolade',
  'Low acidity':'Wenig Säure',
  'Nutty':'Nussig',
  'Balanced':'Ausgewogen',
  'Caramel':'Karamell',
  'Smooth':'Weich',
  'Creamy':'Cremig',
  'Cocoa':'Kakao',
  'Roasted nut':'Geröstete Nuss',
  'Classic':'Klassisch',
  'Full-bodied':'Vollmundig',
  'Mild acidity':'Milde Säure',
  'Intense':'Intensiv',
  'Dark chocolate':'Zartbitterschokolade',
  'Fruity':'Fruchtig',
  'Rich':'Reichhaltig',
  'Nut':'Nuss',
  'Aromatic':'Aromatisch',
  'Roasted':'Röstig',
  'Traditional':'Traditionell',
  'Dried fruit':'Trockenfrüchte',
  'Honey':'Honig',
  'Floral':'Blumig',
  'Hazelnut':'Haselnuss',
  'Brown sugar':'Brauner Zucker',
  'Woody':'Holzig',
  'Spice':'Gewürze',
  'Sweet':'Süß',
  'Bitter-sweet':'Bittersüß',
  'Caramelized':'Karamellisiert',
  'Milk chocolate':'Milchschokolade',
  'Red berry':'Rote Beere',
  'Jasmine':'Jasmin',
  'Blueberry':'Blaubeere',
  'Berry':'Beere',
  'Bright':'Spritzig',
  'Clean':'Klar',
  'Citrus':'Zitrus',
  'Earthy':'Erdig',
  'Spiced':'Gewürzt',
  'Spicy':'Würzig',
  'Malty':'Malzig',
  'Smoky':'Rauchig',
  'Delicate':'Zart',
  'Complex':'Komplex',
  'Red fruit':'Rote Früchte',
  'Tea-like':'Teeartig',
  'Crisp':'Frisch',

  /* ============================================================
     The challenges.

     Title, blurb and tag live in `challenge_templates` in Postgres
     (platform/supabase/step-1.17.sql) and are written there in English,
     because the row is the same row for everybody. Like the inbox
     bodies below, they are translated on the way out — the server has
     no idea which language the reader picked. Adding a template there
     means adding its three lines here, or German readers get the
     English one.
     ============================================================ */
  'Five Mornings':'Fünf Morgen',
  'Log a coffee on five different days this week.':'Trag an fünf verschiedenen Tagen dieser Woche einen Kaffee ein.',
  'Seven for Seven':'Sieben von sieben',
  'A coffee every single day this week. No days off.':'Jeden einzelnen Tag dieser Woche ein Kaffee. Keine Pause.',
  'Before Eight':'Vor acht',
  'Three coffees logged before 8am — the quiet ones.':'Drei Kaffees vor 8 Uhr eingetragen — die stillen.',
  'Both Days':'Beide Tage',
  'Pour on Saturday and again on Sunday.':'Am Samstag einen, am Sonntag noch einen.',
  'Nightcap':'Absacker',
  'Two coffees after 8pm. Decaf counts — nobody is judging.':'Zwei Kaffees nach 20 Uhr. Entkoffeiniert zählt auch — niemand urteilt.',
  'Ten Cups':'Zehn Tassen',
  'Ten coffees logged before the week is out.':'Zehn Kaffees, bevor die Woche vorbei ist.',
  'Rosetta Week':'Rosetta-Woche',
  'Pour three rosettas. Wobble the jug, drag through.':'Gieß drei Rosetten. Kännchen wackeln, durchziehen.',
  'Start with a Heart':'Fang mit einem Herz an',
  'Three hearts. The one everything else is built on.':'Drei Herzen. Das, auf dem alles andere aufbaut.',
  'Tulip Season':'Tulpenzeit',
  'Three tulips — stack at least two pushes into each.':'Drei Tulpen — mindestens zwei Schübe in jede.',
  'The Swan':'Der Schwan',
  'Two swans. Nobody said it would be quick.':'Zwei Schwäne. Niemand hat gesagt, dass es schnell geht.',
  'Show Your Work':'Zeig deine Rechnung',
  'Four pours with dose, yield and time all filled in.':'Vier Kaffees mit Menge, Ertrag und Zeit — alles ausgefüllt.',
  'Free Pour Five':'Fünf frei gegossen',
  'Five latte-art pours, any pattern you like.':'Fünf Kaffees mit Latte Art, Muster egal.',
  'Say Something':'Sag was dazu',
  'Four pours with a real note on how it went.':'Vier Kaffees mit einer echten Notiz, wie es lief.',
  'Three Bags':'Drei Tüten',
  'Brew three different coffees this week.':'Brüh diese Woche drei verschiedene Kaffees.',
  'New Territory':'Neuland',
  'Log one coffee you have never logged before.':'Trag einen Kaffee ein, den du noch nie eingetragen hast.',
  'Round the Menu':'Einmal quer durch die Karte',
  'Four different drinks. Yes, the filter counts.':'Vier verschiedene Getränke. Ja, der Filterkaffee zählt.',
  'Out and Out':'Raus und weiter',
  'Coffee at two different cafés. Leave the house.':'Kaffee in zwei verschiedenen Cafés. Geh vor die Tür.',
  'Passport':'Reisepass',
  'Beans grown in three different countries.':'Bohnen aus drei verschiedenen Ländern.',
  'Three Roasters':'Drei Röstereien',
  'Coffee from three different roasters.':'Kaffee von drei verschiedenen Röstereien.',
  'Milk Run':'Milchrunde',
  'Three different milks. Oat, whole, whatever else.':'Drei verschiedene Milchsorten. Hafer, Vollmilch, was auch immer.',
  'Good Company':'Gute Gesellschaft',
  'Leave five comments on other people\'s coffee.':'Schreib fünf Kommentare unter den Kaffee anderer Leute.',
  '#ritual':'#ritual',
  '#earlybird':'#frühaufsteher',
  '#weekend':'#wochenende',
  '#latenight':'#spätabends',
  '#volume':'#menge',
  '#rosetta':'#rosetta',
  '#heart':'#herz',
  '#tulip':'#tulpe',
  '#swan':'#schwan',
  '#recipe':'#rezept',
  '#latteart':'#latteart',
  '#notes':'#notizen',
  '#beans':'#bohnen',
  '#newbean':'#neuebohne',
  '#menu':'#karte',
  '#cafes':'#cafés',
  '#origin':'#herkunft',
  '#roasters':'#röstereien',
  '#milk':'#milch',
  '#community':'#community',

  /* ============================================================
     Inbox rows the server writes.

     Same rule as the challenges: the trigger composes these in English
     in Postgres and has no idea who is reading them, so the whole body
     is matched here as literal text. Where the body carries a number or
     a name the server has already substituted, notifBody() in
     data/notifications.js pulls the variable part out first and the key
     below keeps its {placeholder}.
     ============================================================ */
  'liked your pour':'gefällt dein Kaffee',
  'commented on your pour':'hat deinen Kaffee kommentiert',
  'mentioned you in a comment':'hat dich in einem Kommentar erwähnt',
  'poured a coffee':'hat einen Kaffee gemacht',
  'started following you':'folgt dir jetzt',
  'wants to follow you':'möchte dir folgen',
  'accepted your follow request':'hat deine Anfrage angenommen',
  'loved your latte art':'mag deine Latte Art',
  'loved where you had it':'mag den Ort, an dem du ihn hattest',
  'loved your choice of coffee':'mag deine Kaffeewahl',
  'reacted to your pour':'hat auf deinen Kaffee reagiert',
  '🥇 1st place on today\'s podium':'🥇 1. Platz auf dem Podium des Tages',
  '🥈 2nd place on today\'s podium':'🥈 2. Platz auf dem Podium des Tages',
  '🥉 3rd place on today\'s podium':'🥉 3. Platz auf dem Podium des Tages',
  'Challenge complete: {title} · +{n} points':'Challenge geschafft: {title} · +{n} Punkte',
  'We looked at what you reported and acted on it. Thank you for flagging it.':
    'Wir haben uns deine Meldung angesehen und gehandelt. Danke, dass du sie geschickt hast.',
  'We looked at what you reported and left it up. Thank you for flagging it.':
    'Wir haben uns deine Meldung angesehen und den Beitrag stehen lassen. Danke, dass du sie geschickt hast.',

  /* ---------- push, and push only ----------
     These never appear on a screen inside the app: they are the two
     notifications Crema sends on its own initiative, composed in plpgsql
     by push_streak_reminders() and push_weekly_digest() in
     platform/supabase/step-1.16.sql. They live here anyway so that all
     the German is in one file — `gen-push-i18n.mjs` reads them out of
     here and prints the seed for `push_i18n`, which is what Postgres
     actually reads at send time. An audit of unused keys will call these
     dead; they are not. */
  'Your streak ends tonight':'Dein Streak endet heute Abend',
  '{n} days so far — one pour keeps it going.':'{n} Tage bisher — ein Kaffee hält ihn am Leben.',
  '{n} pour':'{n} Kaffee',
  '{n} pours':'{n} Kaffees',
  '{n} like':'{n} Like',
  '{n} likes':'{n} Likes',
  '{n} new follower':'{n} neuer Follower',
  '{n} new followers':'{n} neue Follower',

  /* ---------- the desktop pitch beside the phone (index.html) ---------- */
  'A cup a day.':'Eine Tasse am Tag.',
  'Crema is where people keep a record of the coffee they make, and see what everyone else made this morning. The beans are ones you can buy, and the streaks are built from real timestamps.':
    'Crema ist der Ort, an dem Leute festhalten, welchen Kaffee sie machen — und sehen, was alle anderen heute Morgen gemacht haben. Die Bohnen kannst du wirklich kaufen, und die Streaks stehen auf echten Zeitstempeln.',
  'Log every cup':'Jede Tasse eintragen',
  'Keep the streak':'Den Streak halten',
  'See the morning':'Den Morgen sehen',
  'Beans you can actually buy':'Bohnen, die es wirklich gibt',
  'you@example.com':'du@example.com',
  'Datenschutz / Privacy':'Datenschutz',
  'Datenschutz / Privacy Policy':'Datenschutzerklärung',

  /* ---------- the bits that were still English on screen ---------- */
  'PREMIUM':'PREMIUM',
  'ACTIVE':'AKTIV',
  'SYNCED':'SYNCHRON',
  '✦ Crema Premium':'✦ Crema Premium',
  'Signed out':'Abgemeldet',
  'Could not read that file':'Diese Datei ließ sich nicht lesen',
  'A pour on Crema':'Ein Kaffee auf Crema',

  /* ---------- errors thrown deeper down and shown as they arrive ---------- */
  'Sign in first.':'Melde dich zuerst an.',
  'Crema is not configured to reach its backend.':'Crema ist nicht für den Zugriff auf sein Backend eingerichtet.',
  'Sign-in could not be completed — please try again.':'Die Anmeldung konnte nicht abgeschlossen werden — bitte versuch es noch einmal.',
  'Sign-in needs browser storage — check your privacy settings.':
    'Die Anmeldung braucht den Browser-Speicher — sieh in deinen Datenschutzeinstellungen nach.',
  'Could not claim a username — try a different one in Settings.':
    'Der Benutzername ließ sich nicht vergeben — probier in den Einstellungen einen anderen.',

  /* ---------- misc ---------- */
  'Challenge complete: {title} · +{n} 🎯':'Challenge geschafft: {title} · +{n} 🎯',
  '{n} challenges complete 🎯':'{n} Challenges geschafft 🎯',
  'Coming soon':'Kommt bald'
};
