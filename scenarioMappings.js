export const scenarioMappings = {
  "PLA-2630": {
    title: "make the edit suggestion button more prominent",
    original: [
      "Given I am an #soloadviser with access to the CRM Updater",
      "When I view the list of suggestions",
      "Then I see a button next to Include in update",
      "copy: \"Edit\"",
      "icon next to copy - pencil icon (as today)"
    ],
    mapped: [
      "Given I am an #soloadviser with access to the CRM Updater",
      "When Click the 'Profile icon' on top right corner",
      "And Click the 'CRM Updater' option",
      "And Click the first client name in the 'Clients with updates pending' table",
      "And Check that the Edit button next to Include in update has a pencil icon",
      "And Click the 'Close' button labeled 'X'",
      "Then Click the 'PlannerPal' logo"
    ]
  },

  "PLA-2535": {
    title: "Invite via link for recording not appearing for clients with no existing audio",
    original: [
      "Given I am a #soloadviser",
      "When I view a client with no previous recordings",
      "Then the Join call via button is visible - so I can use the recall.ai bot to join a teams or zoom call"
    ],
    mapped: [
      "Given I am a #soloadviser",
      "When I click on '+ Add client' button",
      "And click on Select salutation, and click on Mr",
      "And type 'Test' under First name",
      "And type 'Account' under Surname",
      "And click 'Add client' button",
      "Then check the Join call via button is visible - so I can use the recall.ai bot to join a teams or zoom call",
      "Then click on PlannerPal logo"
    ]
  },

  "PLA-2580":{
    title: "Customise your meeting note not working - BUG",
    original: [
      "Given I am a #soloadviser",
      "When go to the hamburger menu (mobile view) or profile panel (widescreen view) and click '/document-settings', then click on 'Edit' against a meeting note, then click on 'Add subheading', enter a name of a subheading (e.g. 'Downsizing plans'), click the 'Generate instructions' button, wait for the instruction to be generated, then click on the 'Save changes button'",
      "Then the additional subheading appears at the bottom of the list of subheadings, and the edit button (with the pencil icon) appears to the right of the subheading"
    ],
    mapped:[
      "Given I am a #soloadviser",
      "When Click the 'Profile icon' on top right corner",
      "And click 'Document settings'",
      "Then click on 'Edit' against a meeting note",
      "And when I then click on 'Add subheadings'", 
      "And enter a name of the subheading 'Downsizing plans'",
      "And click the 'Generate Instructions' button",
      "Then click 'Save changes' button",
      "Click on 'PlannerPal' logo"
    ]
  },

  "PLA-2602":{
    title: "User unable to edit a generated subheading because the pencil icon disappears",
    mapped:[
      "Given I am a #soloadviser",
      "When Click the 'Profile icon' on top right corner",
      "And click 'Document settings'",
      "And Click the 'Edit' button next to the first item listed under 'Meeting Notes'",
      "And when I then click on 'Add subheadings'",
      "And enter a name of the subheading 'XYZ'",
      "Then click the 'Generate Instructions' button, wait for the Instructions to load",
      "And click 'Save changes' button",
      "Then I should see the new subheading at the bottom of the list, with edit and delete buttons to its right",
      "Then click on 'PlannerPal' logo"
    ]
  },

  "PLA-2609":{
    title: "Sizing of instructions box",
    mapped:[
      "Given I am a #soloadviser",
      "When Click the 'Profile icon' on top right corner",
      "And click 'Document settings'",
      "And Click the 'Edit' button next to the first item listed under 'Meeting Notes'",
      "And when I then click on 'Add subheadings'",
      "And enter a name of the subheading 'Contents'",
      "Then click the 'Generate Instructions' button",
      "Then the instructions for this subheading are generated and are fully visible in the text box (i.e the user doesn't have to scroll vertically within the text box to read the full instruction) after click save changes button",
      "And click on 'Previous' button"
    ]
  },

  "PLA-2705":{
    title:"Change behaviour of clicking on logo.",
    mapped:[
      "Given I am a #soloadviser OR #superuser OR #employedadviser 'Or #plannerpaladmin who is signed in'",
      "When I click on the Help & Tutorials button",
      "Then click on PlannerPal logo, check if the page is navigated to home page",
      "Given I am a #soloadviser OR #superuser OR #employedadviser Or #plannerpaladmin who is not signed in",
      "When I click on profile icon on top right orner",
      "And click on Logout button",
      "And click on Signin button",
      "Then click on PlannerPal logo, check if the page is navigated to website"
    ]
  },

  "PLA-2536":{
    title:"Don't show 'Sign In' on the global nav when I am entering my password",
    mapped:[
      "Given I am a  #soloadviser",
      "And I click on profile icon on top right corner",
      "And click on logout button",
      "And I click on SignIn button",
      "And type the Username 'dhanush.kantharaj@protestcorp.com', and click on Signin button",
      "Then check in the password page, Signin on top right corner should not be there",
      "Then click on PlannerPal logo"
    ]
  },

  "PLA-2515":{
    title:"Iress CRM Ids not showing on client that has been imported from Iress",
    mapped:[
      "Given I am #soloadviser OR #employedadviser OR #superuser that has synced with Iress Xplan",
      "And type 'sep24' in search box under Client list",
      "And Click the first matching client entry for 'sep24' in the search results",
      "Then I see a 'Iress entity id' underneath the name of the client group, together with one or more identifiers"
    ]
  },

  "PLA-2485":{
    title:"Save the CRM Updater Suggestions I have selected",
    mapped:[
      "Given I am a #soloadviser OR #employedadviser OR #superuser with access to the CRM Updater",
      "When Click the 'Profile icon' on top right corner",
      "And Click the 'CRM Updater' option",
      "And Click the first client name in the 'Clients with updates pending' table",
      "And click on 'Include in update' button",
      "And click on 'X' close button",
      "And again click on first client name in the 'Clients with updates pending' table",
      "Then the suggestions I selected previously are remembered (ie I don't have to start from scratch again)",
      "Given I am an #soloadviser OR #employedadviser OR #superuser  with access to the CRM Updater",
      "When Click the 'Profile icon' on top right corner",
      "And Click the 'CRM Updater' option",
      "And Click the first client name in the 'Clients with updates pending' table",
      "And click on 'Include in update' button",
      "And click on 'Make 1 updates to Iress' button"
    ]
  },

  "PLA-2463":{
    title:"List of documents generated from a transcript",
    mapped:[
      "Given I am a #soloadviser who has generated one or more documents from a transcript",
      "And type 'Doctor Test Reg Group' in search box under Client list",
      "And Click the first matching client entry for 'Doctor Test Reg Group' in the search results",
      "And Click on Audio recordings button",
      "And select the first audio under Audio recordings"
    ]
  },

  "PLA-2762":{
    title:"User able to Generate the Document as Meeting Note",
    mapped:[
      "Given I am a #soloadviser who has generated one or more documents from a transcript",
      "When type 'Doctor Test Reg Group' in search box under Client list",
      "And Click the first matching client entry for 'Doctor Test Reg Group' in the search results",
      "And click on upload recording button",
      "And click on 'Browse files'",
      "And upload the audio from PlannerPal folder",
      "Then select Voice note"
    ]
    //requiresIsolatedSession: true
  }

  // Add more scenarios here
};
