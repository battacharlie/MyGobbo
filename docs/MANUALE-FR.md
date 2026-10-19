# IGOR - ABit/s — Mini-manuel

*Version 0.4.18*

[Italiano](MANUALE.md#italiano) · [English](MANUALE.md#english) · [Español](MANUALE-ES.md) · **Français** · [中文](MANUALE-ZH.md) · [العربية](MANUALE-AR.md)

---

### Qu'est-ce que c'est
IGOR est une petite régie vidéo pour Windows et Mac. La **fenêtre de contrôle** s'affiche sur l'écran principal, la **sortie** passe en plein écran sur le deuxième écran (avec un seul écran, elle apparaît dans une fenêtre). La sortie combine des sources NDI, des caméras et cartes d'acquisition, des vidéos et des images, un minuteur, un bandeau texte et un téléprompteur. La sortie tourne à la fréquence d'images de son écran (Auto) ; vous pouvez la réduire depuis la barre du bas pour économiser les ressources.

### La fenêtre de contrôle en bref
- **Menu du haut**
  - *Fichier* : importer et exporter la configuration, couleur de fond de la sortie.
  - *Affichage* : mode LIGHT, mode studio, instructions affichées ou non, réinitialisation de la disposition, ce mini-manuel.
- **Barre du bas**
  - À gauche (en bleu) : **Réinitialiser les fenêtres des panneaux** remet tous les panneaux de détails à leur place d'origine ; **Détacher la fenêtre Détails** ouvre les détails des entrées dans une fenêtre à part (le même bouton, devenu *Rattacher la fenêtre Détails*, les ramène dans la fenêtre de contrôle).
  - À droite (en gris), sous forme d'icônes : **NDI** (vert = la sortie est diffusée sur le réseau comme source « IGOR - ABit/s », rouge = désactivé ; au survol, on voit le nom et les récepteurs connectés), **écran** (afficher/masquer la sortie), choix de l'**écran** et des **images par seconde**, **importer** et **exporter** la configuration (fichier `.igor`), **langue** (italien, anglais, espagnol, français, chinois, arabe), **contrôleur MIDI**, **Companion / Stream Deck** et **télécommande sur téléphone** (QR code, voir *Contrôle à distance*).
  - Les écrans sont numérotés ainsi : l'écran principal porte le numéro 1, les autres suivent de gauche à droite.
- **Aperçu** (en haut) : faites glisser un élément pour le déplacer, un coin pour le redimensionner (Maj conserve les proportions). Sur les vidéos et les images, les poignées orange servent à recadrer.
- **Colonne des entrées** (à droite) : le bouton bleu **+** ajoute une entrée (NDI, périphérique de capture, média, minuteur, bandeau texte, TelePrompt). Pour créer une scène, cliquez sur **Ajouter une scène** en bas, cliquez sur les entrées à y placer (une ou plusieurs, ou aucune pour une scène vide), puis sur **Ajouter** ; le bouton **LIGHT** passe en mode LIGHT et devient **STUDIO** pour revenir au mode complet (voir plus bas).
  - La liste va du premier plan vers l'arrière-plan ; faites glisser pour changer l'ordre ou pour placer une entrée dans une scène (Ctrl au relâchement = aussi dans cette scène).
  - **Tout afficher**, au-dessus de la liste, rend de nouveau visibles toutes les entrées.
  - Sur chaque ligne : 👁 visible/masqué, ↺ réinitialiser la taille et les réglages de l'entrée, corbeille rouge pour supprimer.
  - Ctrl + clic ou Maj + clic sélectionnent plusieurs lignes ; le clic droit propose *Supprimer* et *Réinitialiser l'entrée* pour toutes les lignes sélectionnées.
- **Détails de l'entrée** (en bas) : les réglages de l'entrée sélectionnée, répartis en panneaux.
  - Chaque panneau se déplace en faisant glisser son titre et s'élargit ou s'allonge depuis ses bords droit et inférieur, indépendamment des autres.
  - Un clic sur le titre (ou sur l'onglet ▾) le réduit à une barre.
  - Le bouton ⧉ ouvre le panneau dans une fenêtre séparée, que vous pouvez placer où vous voulez (même sur un autre écran) ; *Ramener dans la fenêtre de contrôle* le remet en place.

### Couleurs
- Rouge : à l'antenne, et le bouton *Supprimer*.
- Vert : aperçu.
- Bleu et gris IGOR : boutons de commande (CUT en bleu, FADE en gris).

### Scènes et mode studio
Une scène regroupe plusieurs entrées ; une seule scène à la fois est à l'antenne. Les entrées placées hors des scènes restent toujours visibles. Le **mode studio** affiche deux écrans : à gauche l'**aperçu** (vert), à droite ce qui est **à l'antenne** (rouge) ; au centre **CUT** (coupe franche) et **FADE** (fondu), avec le choix de la durée du fondu.

### Mode LIGHT et mode complet
- **Complet** : toutes les fonctions, avec scènes et mode studio.
- **LIGHT** (bouton LIGHT) : pour les ordinateurs moins puissants. Les scènes et le mode studio sont désactivés ; les entrées de la scène à l'antenne deviennent une simple liste, aux mêmes positions, et la sortie n'est pas interrompue. Les autres scènes sont mises de côté et leurs sources (caméras, NDI, vidéos) sont fermées. En mode LIGHT, on ne peut ajouter que des minuteurs, des TelePrompts, des images, un périphérique de capture et un signal NDI.
- Le bouton STUDIO ramène au mode complet : les scènes réapparaissent et la scène précédente revient à l'antenne avec les modifications faites entre-temps. Les entrées ajoutées en mode LIGHT restent hors des scènes.

### Les éléments
- **Minuteur** : compte à rebours ou chronomètre, trois couleurs (départ, fin proche, temps dépassé), cadre clignotant quand le temps est écoulé, horloge à l'arrêt, signal sonore à la fin du temps (cloche ou fichier audio, sortie audio au choix, répétition). Barre d'espace = démarrer/pause.
- **Bandeau texte** : une bande de texte qui défile si elle est plus longue que l'écran.
- **TelePrompt** : texte qui monte à la vitesse choisie ; on le tape, on le colle ou on l'importe (.docx, .rtf, .txt, .html) ; taille des caractères en points ; boutons à icône pour le miroir et la ligne de lecture ; pause et lecture automatiques quand il sort de l'antenne ou y entre.
- **NDI**, **Périphérique de capture**, **Média** (vidéos et images) : ajuster / remplir / étirer, recadrage en % ou en pixels ; pour les vidéos : timeline déplaçable avec début et fin marquables, répétition, lecture à l'antenne, pause et rembobinage hors antenne, audio « Suivre » (actif seulement à l'antenne).
- **Clic droit sur une entrée** : copier, couper, coller, copier et coller les attributs (l'apparence seulement, entre entrées du même type).

### Contrôle à distance
- **MIDI** : choisissez une commande, cliquez sur *Apprendre* et touchez une touche du contrôleur.
- **Companion** : activez *Accepter les commandes via HTTP* et utilisez des adresses comme `http://127.0.0.1:8765/api/cut` (module *Generic HTTP*). Guide complet (en anglais et en italien) : [COMPANION.md](COMPANION.md).
- **Télécommande sur téléphone** (icône du téléphone dans la barre du bas) : activez la télécommande et scannez le QR code avec un téléphone ou une tablette connecté au même réseau Wi-Fi. Depuis la page, on met les scènes en aperçu ou à l'antenne, on utilise CUT et FADE, on active le mode studio, on affiche et masque les entrées, on lance minuteurs et TelePrompt, on ouvre les détails de chaque entrée pour modifier ses réglages et on ajoute entrées et scènes avec **+**. *Nouveau code* change les adresses : les anciens liens ne fonctionnent plus.
- **Page modérateur** : la même fenêtre propose un second QR code à donner au modérateur (une tablette ou son propre téléphone, sur le même réseau). Il ne voit que les entrées pour lesquelles la régie a coché **Afficher sur la page modérateur** (première carte des détails de l'entrée, sous le nom), si elles sont à l'antenne, le temps des minuteurs et quelques commandes : afficher/masquer, lancer/pause/remise à zéro du minuteur, lancer/pause/début du TelePrompt.

### Conseils
- *Affichage → Réinitialiser la disposition des fenêtres* remet panneaux et zones comme au départ.
- La configuration est enregistrée automatiquement ; pour la transférer sur un autre PC, utilisez l'icône *Exporter* dans la barre du bas.
