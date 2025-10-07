import fetch from "node-fetch";

const LINEAR_API_KEY = "lin_api_FusLGLx2yjHouaQa5ij6xktmY36nrLvg8JwGFWdX";

const query = `
  query {
    viewer {
      id
      name
    }
    projects {
      nodes {
        id
        key
        name
      }
    }
  }
`;

fetch("https://api.linear.app/graphql", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": LINEAR_API_KEY,
  },
  body: JSON.stringify({ query }),
})
  .then(res => res.json())
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error("❌ Error:", err));
