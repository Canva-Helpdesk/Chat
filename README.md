# Chat

Een privechat voor vrienden. Maak een gesprek, deel de uitnodigingslink en chat live. Beheer groepen met eigenaars en beheerders en stel je eigen profiel in.

## Starten

```sh
npm install
npm run dev
```

Open daarna http://localhost:5173. De server gebruikt lokaal `chat.sqlite` voor accounts, gesprekken en berichten. Wachtwoorden worden gehasht opgeslagen.

Open de groepsinstellingen via het tandwiel in de chat. Daar kan de eigenaar beheerders aanwijzen en de groep verwijderen; eigenaars en beheerders kunnen de groepsnaam of uitnodigingslink aanpassen. Elk lid kan de groep verlaten. Als de eigenaar vertrekt, wordt een beheerder of anders het oudste lid eigenaar.

Open de profielinstellingen met het tandwiel naast je naam om je naam, foto of wachtwoord aan te passen. Foto's worden verkleind opgeslagen in SQLite.

## Let op

Dit is een MVP. E-mailverificatie, wachtwoordherstel en bescherming tegen misbruik zijn nog niet ingericht. De Render-configuratie gebruikt HTTPS, een eigen `SESSION_SECRET` en SQLite-sessies op de permanente schijf, maar registratie is openbaar.

## Permanent publiceren op Render

De meegeleverde `render.yaml` maakt een Node-webservice met een permanente schijf voor accounts, chats en sessies. Kies in Render **New > Blueprint**, koppel de GitHub-repository en laat Render het blueprintbestand toepassen. Render maakt `SESSION_SECRET` automatisch aan en serveert de app via HTTPS.

Voor permanente schijfopslag is een betaald Render-plan nodig. De preview in Codespaces is tijdelijk en staat los van deze deployment. E-mailverificatie en wachtwoordherstel zijn nog niet beschikbaar; houd registratie daarom beperkt tot mensen met wie je de chat wilt delen.