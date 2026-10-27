## Purpose

How the Controller draws each Agent's Character, works out its Mood from the Task's events, and lets a Member change how the Character looks.

## ADDED Requirements

### Requirement: Each Agent is drawn with its own look
The Controller SHALL draw each Agent as its Character, from the Agent's look: a colour, a shell and the part in each of three sockets (top, sides and decal). Any part SHALL fit any shell. The look SHALL NOT change with the Mood, with one exception: the Character of an Agent whose Machine is offline SHALL be drawn grey with its screen off, keeping its shell and parts.

#### Scenario: Agents with different looks
- **WHEN** the inbox lists two Agents whose looks differ
- **THEN** each row shows that Agent's own shell, colour and parts

#### Scenario: Offline Machine
- **WHEN** an Agent's Machine is offline
- **THEN** its Character is grey with its screen off and keeps its shell and parts

### Requirement: Unknown look values fall back
When a look holds a shell or part value the Controller does not know, the Controller SHALL draw the default for that slot (the box shell, or no part) and SHALL keep the slots it does know. It SHALL NOT fail or hide the Agent.

#### Scenario: A shell from a newer version
- **WHEN** an Agent's look names a shell this Controller does not know
- **THEN** the Character is drawn with the box shell and the Agent's own colour and parts

#### Scenario: An unknown part
- **WHEN** an Agent's look names a top part this Controller does not know
- **THEN** the Character is drawn with no top part and keeps its shell, colour, sides and decal

### Requirement: Mood comes from the Task's events
The Controller SHALL work out the Mood from the Agent's Machine status and the Task's events alone, never from what the LLM writes. In order of precedence: offline while the Machine is offline; waiting while an Approval is open; working while a Turn is open and a command it started has not reported; thinking while a Turn is open with no command running; idle when no Turn has run or the last Turn was stopped by the Member; done when the last Turn ended otherwise.

#### Scenario: An open Approval
- **WHEN** the Task has an Approval that is neither answered nor expired
- **THEN** the Mood is waiting

#### Scenario: A command running
- **WHEN** a Turn is open and a command has started without a result
- **THEN** the Mood is working

#### Scenario: Between commands
- **WHEN** a Turn is open and every command it started has reported
- **THEN** the Mood is thinking

#### Scenario: Stopped by the Member
- **WHEN** the last Turn ended because the Member pressed Stop
- **THEN** the Mood is idle

#### Scenario: Finished
- **WHEN** the last Turn ended without a Stop
- **THEN** the Mood is done

#### Scenario: Offline outranks the Task
- **WHEN** the Machine is offline while the Task has an open Approval
- **THEN** the Mood is offline

### Requirement: The Character at the top of a Task opens its editor
The Character at the top of a Task SHALL be a button, spoken as editing that Agent's Character, that opens the Character editor for that Agent. The editor SHALL slide up as a sheet over the Task on iOS and Android and SHALL be a page with its own address on web. Opening the address of an Agent that does not exist SHALL say so and offer a way back.

#### Scenario: Open from a Task
- **WHEN** the Member taps the Character at the top of a Task
- **THEN** the Character editor opens for that Task's Agent

#### Scenario: Open by address on web
- **WHEN** the Member opens the editor's address for an Agent on web
- **THEN** the editor for that Agent is shown

#### Scenario: Unknown Agent
- **WHEN** the editor's address names an Agent that does not exist
- **THEN** the editor says the Agent was not found and offers a way back

### Requirement: The editor previews the look in every Mood
The editor SHALL show the look being edited large, and the same look at inbox size in every Mood, and SHALL update both as soon as the Member picks an option.

#### Scenario: Picking a shell
- **WHEN** the Member picks a different shell
- **THEN** the large preview and every inbox-size Mood preview show the new shell

### Requirement: Picking edits a draft until Done
The editor SHALL offer every shell, colour, top part, side part and decal, with the Agent's current values selected. Picking an option SHALL change only the editor's draft. Done SHALL apply the whole draft to the Agent at once, and every screen showing that Agent SHALL then draw the new look. Cancel, or dismissing the sheet, SHALL leave the Agent's look unchanged.

#### Scenario: Done applies the draft
- **WHEN** the Member picks a new colour and a new top part and taps Done
- **THEN** the editor closes and the inbox row and the Task show the Agent with both changes

#### Scenario: Cancel discards the draft
- **WHEN** the Member picks a new shell and taps Cancel
- **THEN** the editor closes and the Agent keeps its old shell everywhere

#### Scenario: Swiping the sheet away
- **WHEN** the Member picks a new decal and swipes the sheet down
- **THEN** the Agent keeps its old decal everywhere

### Requirement: Shuffle avoids looks already in use
The editor SHALL offer a shuffle that fills the draft with a random shell, colour and parts. The shuffled look SHALL differ from the look of every other Agent in the Workspace.

#### Scenario: Shuffle
- **WHEN** the Member taps shuffle
- **THEN** the draft holds a look that no other Agent in the Workspace has

### Requirement: The Demo Workspace keeps edits on the phone
In the Demo Workspace, applying a look SHALL keep it on this device only and SHALL NOT send anything off the device.

#### Scenario: Done in the Demo Workspace
- **WHEN** the Member taps Done in the Demo Workspace
- **THEN** the new look shows on this device and no message leaves it

### Requirement: The editor works with a screen reader
Every option in the editor SHALL be a control that speaks its section and value and reports whether it is selected, with a touch target of at least 44 points. The Character drawings in the editor SHALL be hidden from screen readers.

#### Scenario: Reading an option
- **WHEN** a screen reader focuses the selected shell option
- **THEN** it reads the section, the shell's name and that it is selected
